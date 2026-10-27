/**
 * Cómo decide AWS WAF: extraer el campo de la petición, aplicar las transformaciones de texto, comparar, y los grupos de reglas
 * gestionados por AWS (firmas sencillas de SQL injection, XSS, rutas peligrosas, bots, reputación de IP…). Sin estado ni cuentas:
 * solo funciones puras que se pueden probar solas.
 */
import { b64decode } from '../../engine/commands/hash';
import { cidrContainsIp } from '../util';

export interface WafReq {
  method: string;
  /** Solo la ruta (sin `?`). */
  uri: string;
  /** La cadena de consulta, sin el `?`. */
  query: string;
  /** Nombres en minúsculas. */
  headers: Record<string, string>;
  body: string;
  ip: string;
  country: string;
}

export type Statement = Record<string, any>;

export class WafInvalid extends Error {
  constructor(
    public reason: string,
    public field: string,
    public param: string,
  ) {
    super(`Error reason: ${reason}, field: ${field}, parameter: ${param}`);
  }
}

// ───────────────────────── campos y transformaciones ─────────────────────────

const urlDecode = (s: string): string => {
  const t = s.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(t);
  } catch {
    return t.replace(/%([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
  }
};

const HTML_ENT: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };
const htmlDecode = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCharCode(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return HTML_ENT[e.toLowerCase()] ?? m;
  });

export const TRANSFORMS = ['NONE', 'COMPRESS_WHITE_SPACE', 'HTML_ENTITY_DECODE', 'LOWERCASE', 'CMD_LINE', 'URL_DECODE', 'BASE64_DECODE', 'HEX_DECODE', 'MD5', 'REPLACE_COMMENTS', 'ESCAPE_SEQ_DECODE', 'SQL_HEX_DECODE', 'CSS_DECODE', 'JS_DECODE', 'NORMALIZE_PATH', 'NORMALIZE_PATH_WIN', 'REMOVE_NULLS', 'REPLACE_NULLS', 'BASE64_DECODE_EXT', 'URL_DECODE_UNI', 'UTF8_TO_UNICODE'];

function transform(v: string, type: string): string {
  switch (type) {
    case 'LOWERCASE':
      return v.toLowerCase();
    case 'URL_DECODE':
    case 'URL_DECODE_UNI':
      return urlDecode(v);
    case 'HTML_ENTITY_DECODE':
      return htmlDecode(v);
    case 'COMPRESS_WHITE_SPACE':
      return v.replace(/\s+/g, ' ');
    case 'REMOVE_NULLS':
      return v.replace(/\0/g, '');
    case 'REPLACE_NULLS':
      return v.replace(/\0/g, ' ');
    case 'REPLACE_COMMENTS':
      return v.replace(/\/\*[\s\S]*?\*\//g, ' ');
    case 'CMD_LINE':
      return v.replace(/[\\"'^]/g, '').replace(/\s*([,;])\s*/g, '$1').replace(/\s+/g, ' ').toLowerCase();
    case 'NORMALIZE_PATH':
      return v.replace(/\/{2,}/g, '/').replace(/\/\.\//g, '/');
    default:
      return v;
  }
}

export function applyTransforms(v: string, tfs: { Priority: number; Type: string }[] | undefined): string {
  return [...(tfs ?? [])].sort((a, b) => Number(a.Priority) - Number(b.Priority)).reduce((acc, t) => transform(acc, t.Type), v);
}

/** Los valores del campo que mira la regla (la regla se cumple si alguno coincide). */
export function fieldValues(r: WafReq, f: Statement | undefined): string[] {
  if (!f) return [];
  if (f.UriPath) return [r.uri];
  if (f.QueryString) return [r.query];
  if (f.Method) return [r.method];
  if (f.Body || f.JsonBody) return [r.body];
  if (f.SingleHeader) {
    const v = r.headers[String(f.SingleHeader.Name).toLowerCase()];
    return v === undefined ? [] : [v];
  }
  if (f.SingleQueryArgument) {
    const v = new URLSearchParams(r.query).getAll(String(f.SingleQueryArgument.Name).toLowerCase());
    return v.length ? v : new URLSearchParams(r.query).getAll(String(f.SingleQueryArgument.Name));
  }
  if (f.AllQueryArguments) return [...new URLSearchParams(r.query).values()];
  if (f.Headers) return Object.values(r.headers);
  if (f.Cookies) return (r.headers.cookie ?? '').split(';').map((c) => c.slice(c.indexOf('=') + 1).trim()).filter(Boolean);
  return [];
}

const FIELD_KEYS = ['UriPath', 'QueryString', 'Method', 'Body', 'JsonBody', 'SingleHeader', 'SingleQueryArgument', 'AllQueryArguments', 'Headers', 'Cookies'];

// ───────────────────────── detección de SQL y XSS ─────────────────────────

const SQLI = [/'\s*(or|and)\s+['"\d(]/i, /\b(or|and)\s+\d+\s*=\s*\d+/i, /\bunion\s+(all\s+)?select\b/i, /;\s*(drop|delete|insert|update|truncate|alter)\s/i, /--\s*$/m, /\bsleep\s*\(\s*\d/i, /\bbenchmark\s*\(/i, /\binformation_schema\b/i, /\bxp_cmdshell\b/i, /'\s*;\s*--/, /\bselect\b[\s\S]+\bfrom\b/i, /\bwaitfor\s+delay\b/i, /'\s*(or|and)\s*'[^']*'\s*=\s*'/i];
const XSS = [/<\s*script\b/i, /javascript\s*:/i, /\bon(error|load|click|mouseover|focus)\s*=/i, /<\s*(iframe|object|embed|svg)\b/i, /<\s*img\b[^>]*\bon\w+\s*=/i, /\balert\s*\(/i, /document\.(cookie|location)/i];

export const looksLikeSqli = (s: string): boolean => SQLI.some((p) => p.test(s));
export const looksLikeXss = (s: string): boolean => XSS.some((p) => p.test(s));

// ───────────────────────── grupos gestionados por AWS ─────────────────────────

/** Direcciones «malas» de la lista de reputación de IP de Amazon (las usan también los retos de GuardDuty). */
export const REPUTATION_CIDRS = ['198.51.100.66/32', '198.51.100.67/32', '192.0.2.66/32', '203.0.113.200/32'];
const RECON_CIDRS = ['192.0.2.99/32'];
const DDOS_CIDRS = ['198.51.100.200/29'];
const ANON_CIDRS = ['100.64.13.0/24'];
const HOSTING_CIDRS = ['198.18.0.0/15'];

const inAny = (cidrs: string[], ip: string): boolean => cidrs.some((c) => cidrContainsIp(c, ip));

export interface ManagedRule {
  name: string;
  action: 'Block' | 'Count';
  test: (r: WafReq) => boolean;
}

export interface ManagedGroup {
  name: string;
  description: string;
  capacity: number;
  rules: ManagedRule[];
}

const norm = (s: string) => urlDecode(htmlDecode(s)).toLowerCase();
const cookieOf = (r: WafReq) => r.headers.cookie ?? '';
const BAD_BOTS = /(sqlmap|nikto|nessus|masscan|zgrab|dirbuster|gobuster|hydra|wpscan|acunetix|havij|nmap|metasploit)/i;
const EXT = /\.(log|ini|bak|conf|cfg|sql|backup|old|swp|env|pem|key)$/i;
const SSRF = /(169\.254\.169\.254|instance-data|\[fd00:ec2::254\])/i;
const LFI = /(\.\.\/|\.\.\\|\/etc\/(passwd|shadow)|\/proc\/self\/)/i;
const RFI = /(https?|ftp):\/\/\S+/i;
const LOG4J = /\$\{\s*(jndi|lower|upper|env|sys|java|::-)/i;
const JAVA_DESER = /(rO0AB|java\.lang\.(Runtime|ProcessBuilder)|java\.io\.ObjectInputStream)/;

const part = (r: WafReq) => ({ uri: norm(r.uri), args: norm(r.query), body: norm(r.body), cookie: norm(cookieOf(r)) });

const mk = (name: string, test: (r: WafReq) => boolean, action: 'Block' | 'Count' = 'Block'): ManagedRule => ({ name, action, test });

export const MANAGED: ManagedGroup[] = [
  {
    name: 'AWSManagedRulesCommonRuleSet',
    description: 'Protección general contra las vulnerabilidades más comunes de aplicaciones web (OWASP): XSS, rutas relativas, SSRF, cuerpos enormes…',
    capacity: 700,
    rules: [
      mk('NoUserAgent_HEADER', (r) => !r.headers['user-agent']),
      mk('UserAgent_BadBots_HEADER', (r) => BAD_BOTS.test(r.headers['user-agent'] ?? '')),
      mk('SizeRestrictions_QUERYSTRING', (r) => r.query.length > 2048),
      mk('SizeRestrictions_Cookie_HEADER', (r) => cookieOf(r).length > 10240),
      mk('SizeRestrictions_BODY', (r) => r.body.length > 8192),
      mk('SizeRestrictions_URIPATH', (r) => r.uri.length > 1024),
      mk('EC2MetaDataSSRF_BODY', (r) => SSRF.test(part(r).body)),
      mk('EC2MetaDataSSRF_COOKIE', (r) => SSRF.test(part(r).cookie)),
      mk('EC2MetaDataSSRF_URIPATH', (r) => SSRF.test(part(r).uri)),
      mk('EC2MetaDataSSRF_QUERYARGUMENTS', (r) => SSRF.test(part(r).args)),
      mk('GenericLFI_QUERYARGUMENTS', (r) => LFI.test(part(r).args)),
      mk('GenericLFI_URIPATH', (r) => LFI.test(part(r).uri)),
      mk('GenericLFI_BODY', (r) => LFI.test(part(r).body)),
      mk('RestrictedExtensions_URIPATH', (r) => EXT.test(part(r).uri)),
      mk('RestrictedExtensions_QUERYARGUMENTS', (r) => [...new URLSearchParams(r.query).values()].some((v) => EXT.test(norm(v)))),
      mk('GenericRFI_QUERYARGUMENTS', (r) => RFI.test(part(r).args)),
      mk('GenericRFI_BODY', (r) => RFI.test(part(r).body)),
      mk('CrossSiteScripting_COOKIE', (r) => looksLikeXss(part(r).cookie)),
      mk('CrossSiteScripting_QUERYARGUMENTS', (r) => looksLikeXss(part(r).args)),
      mk('CrossSiteScripting_BODY', (r) => looksLikeXss(part(r).body)),
      mk('CrossSiteScripting_URIPATH', (r) => looksLikeXss(part(r).uri)),
    ],
  },
  {
    name: 'AWSManagedRulesSQLiRuleSet',
    description: 'Patrones de ataques de inyección SQL: consultas, cuerpo, cookies y ruta.',
    capacity: 200,
    rules: [
      mk('SQLi_QUERYARGUMENTS', (r) => looksLikeSqli(part(r).args)),
      mk('SQLiExtendedPatterns_QUERYARGUMENTS', (r) => /(\bselect\b.+\bfrom\b|\bunion\b.+\bselect\b|0x[0-9a-f]{6,})/i.test(part(r).args)),
      mk('SQLi_BODY', (r) => looksLikeSqli(part(r).body)),
      mk('SQLi_COOKIE', (r) => looksLikeSqli(part(r).cookie)),
      mk('SQLi_URIPATH', (r) => looksLikeSqli(part(r).uri)),
    ],
  },
  {
    name: 'AWSManagedRulesKnownBadInputsRuleSet',
    description: 'Peticiones que se sabe que explotan vulnerabilidades (Log4j, deserialización de Java, host localhost…).',
    capacity: 200,
    rules: [
      mk('JavaDeserializationRCE_BODY', (r) => JAVA_DESER.test(r.body)),
      mk('JavaDeserializationRCE_URIPATH', (r) => JAVA_DESER.test(r.uri)),
      mk('JavaDeserializationRCE_QUERYSTRING', (r) => JAVA_DESER.test(r.query)),
      mk('JavaDeserializationRCE_HEADER', (r) => Object.values(r.headers).some((v) => JAVA_DESER.test(v))),
      mk('Host_localhost_HEADER', (r) => /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(r.headers.host ?? '')),
      mk('PROPFIND_METHOD', (r) => r.method.toUpperCase() === 'PROPFIND'),
      mk('ExploitablePaths_URIPATH', (r) => /(\/actuator\/|\/\.git\/|\/vendor\/phpunit|\/cgi-bin\/)/i.test(norm(r.uri))),
      mk('Log4JRCE_QUERYSTRING', (r) => LOG4J.test(norm(r.query))),
      mk('Log4JRCE_BODY', (r) => LOG4J.test(norm(r.body))),
      mk('Log4JRCE_URIPATH', (r) => LOG4J.test(norm(r.uri))),
      mk('Log4JRCE_HEADER', (r) => Object.values(r.headers).some((v) => LOG4J.test(norm(v)))),
    ],
  },
  {
    name: 'AWSManagedRulesAmazonIpReputationList',
    description: 'IP que Amazon ha visto atacando: bots, reconocimiento de redes y DDoS.',
    capacity: 25,
    rules: [mk('AWSManagedIPReputationList', (r) => inAny(REPUTATION_CIDRS, r.ip)), mk('AWSManagedReconnaissanceList', (r) => inAny(RECON_CIDRS, r.ip)), mk('AWSManagedIPDDoSList', (r) => inAny(DDOS_CIDRS, r.ip), 'Count')],
  },
  {
    name: 'AWSManagedRulesAnonymousIpList',
    description: 'Orígenes que ocultan quién es el cliente: TOR, proxies anónimos, VPN y proveedores de alojamiento.',
    capacity: 50,
    rules: [mk('AnonymousIPList', (r) => inAny(ANON_CIDRS, r.ip)), mk('HostingProviderIPList', (r) => inAny(HOSTING_CIDRS, r.ip))],
  },
  {
    name: 'AWSManagedRulesLinuxRuleSet',
    description: 'Ataques propios de Linux: lectura de archivos locales (LFI) como /etc/passwd o ../.',
    capacity: 200,
    rules: [mk('LFI_URIPATH', (r) => LFI.test(part(r).uri)), mk('LFI_QUERYSTRING', (r) => LFI.test(part(r).args)), mk('LFI_HEADER', (r) => Object.entries(r.headers).some(([k, v]) => k !== 'cookie' && LFI.test(norm(v))))],
  },
  {
    name: 'AWSManagedRulesAdminProtectionRuleSet',
    description: 'Bloquea el acceso a páginas de administración expuestas (/admin, /phpmyadmin, /wp-admin…).',
    capacity: 100,
    rules: [mk('AdminProtection_URIPATH', (r) => /^\/(admin|administrator|phpmyadmin|wp-admin|manager\/html)(\/|$)/i.test(norm(r.uri)))],
  },
];

export const managedGroup = (vendor: string, name: string): ManagedGroup | undefined => (vendor === 'AWS' ? MANAGED.find((g) => g.name === name) : undefined);

// ───────────────────────── direcciones ─────────────────────────

/** Valida una dirección o rango en notación CIDR como lo hace AWS WAF (hay que poner la máscara, también `/32`). */
export function validCidr(v: string, version: 'IPV4' | 'IPV6'): boolean {
  if (version === 'IPV4') {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(v);
    return !!m && [m[1], m[2], m[3], m[4]].every((o) => Number(o) <= 255) && Number(m[5]) >= 8 && Number(m[5]) <= 32;
  }
  const m = /^[0-9a-f:]+\/(\d{1,3})$/i.exec(v);
  return !!m && Number(m[1]) >= 16 && Number(m[1]) <= 128;
}

/** La IP que la regla tiene que mirar: la del cliente o la que viene en una cabecera (`ForwardedIPConfig`). */
function ipFor(r: WafReq, cfg: Statement | undefined): string | undefined {
  if (!cfg?.HeaderName) return r.ip;
  const raw = r.headers[String(cfg.HeaderName).toLowerCase()];
  if (!raw) return cfg.FallbackBehavior === 'MATCH' ? '' : undefined;
  const parts = raw.split(',').map((x) => x.trim());
  const pos = String(cfg.Position ?? 'FIRST');
  return pos === 'LAST' ? parts[parts.length - 1] : parts[0];
}

// ───────────────────────── evaluación de condiciones ─────────────────────────

export interface EvalCx {
  req: WafReq;
  ipSet: (arn: string) => string[] | undefined;
  /** Registra la petición en el contador de la regla y devuelve cuántas lleva en la ventana. */
  rate: (key: string, windowSec: number) => number;
  /** Para los contadores por tasa: identifica la regla. */
  ruleKey: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** SearchString llega en base64 desde la CLI v2; aquí vale tanto el texto como su base64. */
function searchText(s: string): string {
  if (/^[A-Za-z0-9+/]{8,}={0,2}$/.test(s) && s.length % 4 === 0) {
    const t = b64decode(s);
    if (t && /^[\x20-\x7e]+$/.test(t)) return t;
  }
  return s;
}

function positional(search: string, v: string, pos: string): boolean {
  switch (pos) {
    case 'EXACTLY':
      return v === search;
    case 'STARTS_WITH':
      return v.startsWith(search);
    case 'ENDS_WITH':
      return v.endsWith(search);
    case 'CONTAINS_WORD':
      return new RegExp(`(^|[^A-Za-z0-9_])${esc(search)}($|[^A-Za-z0-9_])`).test(v);
    default:
      return v.includes(search);
  }
}

const cmp = (op: string, a: number, b: number): boolean => (op === 'EQ' ? a === b : op === 'NE' ? a !== b : op === 'LE' ? a <= b : op === 'LT' ? a < b : op === 'GE' ? a >= b : a > b);

/** ¿Cumple la petición la condición? */
export function matches(st: Statement, cx: EvalCx): boolean {
  const r = cx.req;
  if (st.ByteMatchStatement) {
    const s = st.ByteMatchStatement;
    const needle = searchText(String(s.SearchString ?? ''));
    return fieldValues(r, s.FieldToMatch).some((v) => positional(needle, applyTransforms(v, s.TextTransformations), String(s.PositionalConstraint ?? 'CONTAINS')));
  }
  if (st.SqliMatchStatement) {
    const s = st.SqliMatchStatement;
    return fieldValues(r, s.FieldToMatch).some((v) => looksLikeSqli(applyTransforms(v, s.TextTransformations)));
  }
  if (st.XssMatchStatement) {
    const s = st.XssMatchStatement;
    return fieldValues(r, s.FieldToMatch).some((v) => looksLikeXss(applyTransforms(v, s.TextTransformations)));
  }
  if (st.SizeConstraintStatement) {
    const s = st.SizeConstraintStatement;
    return fieldValues(r, s.FieldToMatch).some((v) => cmp(String(s.ComparisonOperator), applyTransforms(v, s.TextTransformations).length, Number(s.Size)));
  }
  if (st.RegexMatchStatement) {
    const s = st.RegexMatchStatement;
    let re: RegExp;
    try {
      re = new RegExp(String(s.RegexString));
    } catch {
      return false;
    }
    return fieldValues(r, s.FieldToMatch).some((v) => re.test(applyTransforms(v, s.TextTransformations)));
  }
  if (st.GeoMatchStatement) {
    const s = st.GeoMatchStatement;
    const ip = ipFor(r, s.ForwardedIPConfig);
    const country = ip === r.ip ? r.country : '';
    return !!country && (s.CountryCodes as string[]).map((c) => c.toUpperCase()).includes(country);
  }
  if (st.IPSetReferenceStatement) {
    const s = st.IPSetReferenceStatement;
    const ip = ipFor(r, s.IPSetForwardedIPConfig);
    const list = cx.ipSet(String(s.ARN));
    return !!ip && !!list && list.some((c) => cidrContainsIp(c, ip));
  }
  if (st.RateBasedStatement) {
    const s = st.RateBasedStatement;
    if (s.ScopeDownStatement && !matches(s.ScopeDownStatement, cx)) return false;
    const key = s.AggregateKeyType === 'CONSTANT' ? 'all' : s.AggregateKeyType === 'FORWARDED_IP' ? ipFor(r, s.ForwardedIPConfig) ?? r.ip : r.ip;
    return cx.rate(`${cx.ruleKey}|${key}`, Number(s.EvaluationWindowSec ?? 300)) > Number(s.Limit);
  }
  if (st.AndStatement) return (st.AndStatement.Statements as Statement[]).every((x) => matches(x, cx));
  if (st.OrStatement) return (st.OrStatement.Statements as Statement[]).some((x) => matches(x, cx));
  if (st.NotStatement) return !matches(st.NotStatement.Statement, cx);
  return false;
}

// ───────────────────────── validación y capacidad (WCU) ─────────────────────────

export interface CheckCx {
  ipSetExists: (arn: string) => boolean;
}

const POSITIONS = ['EXACTLY', 'STARTS_WITH', 'ENDS_WITH', 'CONTAINS', 'CONTAINS_WORD'];
const OPERATORS = ['EQ', 'NE', 'LE', 'LT', 'GE', 'GT'];

function checkField(st: Statement, what: string): void {
  const f = st.FieldToMatch as Statement | undefined;
  if (!f || typeof f !== 'object' || !FIELD_KEYS.some((k) => f[k] !== undefined)) throw new WafInvalid('Exactly one field of FieldToMatch must be specified', 'FIELD_TO_MATCH', what);
  if (!Array.isArray(st.TextTransformations) || !st.TextTransformations.length) throw new WafInvalid('You must specify at least one text transformation (use NONE for none)', 'TEXT_TRANSFORMATION', what);
  for (const t of st.TextTransformations as Statement[]) if (!TRANSFORMS.includes(String(t.Type))) throw new WafInvalid('The text transformation type is not valid', 'TEXT_TRANSFORMATION', String(t.Type));
}

const tfCost = (st: Statement) => 10 * (st.TextTransformations as Statement[]).filter((t) => t.Type !== 'NONE').length;

/** Comprueba la condición y devuelve las WCU (unidades de capacidad) que consume. */
export function check(st: Statement, cx: CheckCx, top = true): number {
  const keys = Object.keys(st ?? {});
  if (keys.length !== 1) throw new WafInvalid('Exactly one statement type must be specified', 'STATEMENT', keys.join(','));
  const k = keys[0];
  const s = st[k] as Statement;
  switch (k) {
    case 'ByteMatchStatement': {
      checkField(s, 'ByteMatchStatement');
      if (!POSITIONS.includes(String(s.PositionalConstraint))) throw new WafInvalid('PositionalConstraint is not valid', 'POSITIONAL_CONSTRAINT', String(s.PositionalConstraint));
      if (s.SearchString === undefined || s.SearchString === '') throw new WafInvalid('SearchString is required', 'SEARCH_STRING', 'ByteMatchStatement');
      return (['CONTAINS', 'CONTAINS_WORD'].includes(String(s.PositionalConstraint)) ? 10 : 2) + tfCost(s);
    }
    case 'SqliMatchStatement':
      checkField(s, k);
      return 20 + tfCost(s);
    case 'XssMatchStatement':
      checkField(s, k);
      return 40 + tfCost(s);
    case 'SizeConstraintStatement':
      checkField(s, k);
      if (!OPERATORS.includes(String(s.ComparisonOperator))) throw new WafInvalid('ComparisonOperator is not valid', 'COMPARISON_OPERATOR', String(s.ComparisonOperator));
      if (!Number.isFinite(Number(s.Size))) throw new WafInvalid('Size must be a number', 'SIZE', String(s.Size));
      return 1 + tfCost(s);
    case 'RegexMatchStatement':
      checkField(s, k);
      try {
        new RegExp(String(s.RegexString));
      } catch {
        throw new WafInvalid('The regular expression is not valid', 'REGEX_PATTERN', String(s.RegexString));
      }
      return 3 + tfCost(s);
    case 'GeoMatchStatement':
      if (!Array.isArray(s.CountryCodes) || !s.CountryCodes.length || (s.CountryCodes as string[]).some((c) => !/^[A-Za-z]{2}$/.test(String(c)))) throw new WafInvalid('CountryCodes must be a list of two-letter country codes', 'COUNTRY_CODE', JSON.stringify(s.CountryCodes));
      return 1;
    case 'IPSetReferenceStatement':
      if (!cx.ipSetExists(String(s.ARN))) throw new WafInvalid('AWS WAF couldn’t find the referenced IP set', 'ARN', String(s.ARN));
      return 1;
    case 'RateBasedStatement': {
      if (!top) throw new WafInvalid('A rate-based statement must be at the top level of a rule or inside And/Or', 'STATEMENT', k);
      const lim = Number(s.Limit);
      if (!Number.isInteger(lim) || lim < 10 || lim > 2000000000) throw new WafInvalid('The rate limit must be between 10 and 2000000000', 'RATE_LIMIT', String(s.Limit));
      if (!['IP', 'FORWARDED_IP', 'CONSTANT'].includes(String(s.AggregateKeyType))) throw new WafInvalid('AggregateKeyType is not valid', 'AGGREGATE_KEY_TYPE', String(s.AggregateKeyType));
      if (s.EvaluationWindowSec !== undefined && ![60, 120, 300, 600].includes(Number(s.EvaluationWindowSec))) throw new WafInvalid('EvaluationWindowSec must be 60, 120, 300 or 600', 'EVALUATION_WINDOW', String(s.EvaluationWindowSec));
      return 2 + (s.ScopeDownStatement ? check(s.ScopeDownStatement, cx, false) : 0);
    }
    case 'AndStatement':
    case 'OrStatement': {
      const list = s.Statements as Statement[] | undefined;
      if (!Array.isArray(list) || list.length < 2) throw new WafInvalid('And/Or statements need at least two statements', 'STATEMENT', k);
      return 1 + list.reduce((n, x) => n + check(x, cx, false), 0);
    }
    case 'NotStatement':
      if (!s.Statement) throw new WafInvalid('A Not statement needs one statement', 'STATEMENT', k);
      return 1 + check(s.Statement, cx, false);
    case 'ManagedRuleGroupStatement': {
      const g = managedGroup(String(s.VendorName), String(s.Name));
      if (!g) throw new WafInvalid('The managed rule group does not exist', 'MANAGED_RULE_GROUP', `${s.VendorName}/${s.Name}`);
      for (const x of [...((s.ExcludedRules as Statement[]) ?? []), ...((s.RuleActionOverrides as Statement[]) ?? [])]) if (!g.rules.some((m) => m.name === x.Name)) throw new WafInvalid(`The group ${g.name} has no rule called ${x.Name}`, 'EXCLUDED_RULE', String(x.Name));
      return g.capacity + (s.ScopeDownStatement ? check(s.ScopeDownStatement, cx, false) : 0);
    }
    default:
      throw new WafInvalid('The statement type is not supported', 'STATEMENT', k);
  }
}

export const isManaged = (st: Statement): boolean => !!st.ManagedRuleGroupStatement || !!st.RuleGroupReferenceStatement;
