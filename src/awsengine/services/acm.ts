/**
 * AWS Certificate Manager: certificados TLS gratuitos para balanceadores y CloudFront, con validación por DNS contra las zonas de
 * Route 53, emisión cuando aparece el registro CNAME, renovación gestionada y caducidad.
 */
import { regional } from '../account';
import { AwsError, op } from '../registry';
import { tick, tickers } from '../tick';
import type { Account } from '../types';
import type { AcmCert, AcmState } from '../types-sec';
import { iso, mkArn, newId, stableId, toArr, wildcard } from '../util';
import { acmHooks } from './acmhooks';
import { r53Lookup } from './route53';

const DAY = 86400000;
const VALIDITY = 395 * DAY;
const MAX_NAMES = 10;
/** Un certificado que no se valida en 72 horas, caduca la solicitud. */
const VALIDATION_WINDOW = 72 * 3600000;

export const acmOf = (a: Account, region: string): AcmState => (regional(a, region).acm ??= { certs: {} });

const uuid = (a: Account, kind: string) => newId(a, kind, '', 32, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

const names = (c: AcmCert) => [c.Domain, ...c.Sans.filter((x) => x !== c.Domain)];
const base = (n: string) => n.replace(/^\*\./, '');
const dot = (n: string) => n.toLowerCase().replace(/\.?$/, '.');

/** El registro CNAME que demuestra que el dominio es tuyo (es el mismo para `tienda.es` y `*.tienda.es`). */
export function validationRecord(a: Account, domain: string): { Name: string; Type: 'CNAME'; Value: string } {
  const b = base(domain).toLowerCase();
  return { Name: `_${stableId(`acm:${a.id}:${b}`, '', 32, 'hex')}.${b}.`, Type: 'CNAME', Value: `_${stableId(`acmv:${a.id}:${b}`, '', 32, 'hex')}.acm-validations.aws.` };
}

/** ¿Está el registro de validación publicado en una zona pública de Route 53? */
function recordPresent(a: Account, domain: string): boolean {
  const rec = validationRecord(a, domain);
  const r = r53Lookup(a, rec.Name, 'CNAME', 0, {});
  return !!r?.answers.some((x) => x.type === 'CNAME' && dot(x.data) === rec.Value);
}

const validated = (a: Account, c: AcmCert) => names(c).every((n) => recordPresent(a, n));

/** ¿Cubre el certificado este nombre? Los comodines cubren un solo nivel. */
export const covers = (c: AcmCert, host: string): boolean => names(c).some((n) => (n.startsWith('*.') ? wildcard(n, host.toLowerCase()) && host.split('.').length === n.split('.').length : n.toLowerCase() === host.toLowerCase()));

/** Servicios que están usando el certificado (balanceadores con oyentes HTTPS). */
function inUseBy(a: Account, region: string, c: AcmCert): string[] {
  const out: string[] = [];
  for (const lb of Object.values(regional(a, region).elb?.lbs ?? {})) for (const l of Object.values(lb.listeners)) if (l.Certificates?.some((x) => x.CertificateArn === c.Arn)) out.push(lb.LoadBalancerArn);
  return out;
}

const findCert = (a: Account, region: string, arn: string): AcmCert => {
  const c = acmOf(a, region).certs[arn];
  if (!c) throw new AwsError('ResourceNotFoundException', `Could not find certificate ${arn}.`, 400);
  return c;
};

const kindOf = (c: AcmCert) => (c.Type === 'IMPORTED' ? 'IMPORTED' : 'AMAZON_ISSUED');

function view(a: Account, region: string, c: AcmCert) {
  const use = inUseBy(a, region, c);
  const dvo = c.Type === 'IMPORTED' ? [] : names(c).map((n) => {
    const ok = c.Status === 'ISSUED' || (c.Status === 'PENDING_VALIDATION' && recordPresent(a, n));
    return { DomainName: n, ValidationDomain: n, ValidationStatus: ok ? 'SUCCESS' : c.Status === 'PENDING_VALIDATION' ? 'PENDING_VALIDATION' : 'FAILED', ResourceRecord: validationRecord(a, n), ValidationMethod: c.Validation };
  });
  return {
    CertificateArn: c.Arn,
    DomainName: c.Domain,
    SubjectAlternativeNames: names(c),
    DomainValidationOptions: dvo,
    Serial: c.issued ? stableId(`serial:${c.Arn}`, '', 32, 'hex').replace(/(..)(?!$)/g, '$1:') : undefined,
    Subject: `CN=${c.Domain}`,
    Issuer: c.Type === 'IMPORTED' ? 'Importado' : 'Amazon',
    CreatedAt: iso(c.created),
    ...(c.issued ? { IssuedAt: iso(c.issued) } : {}),
    Status: c.Status,
    ...(c.notBefore ? { NotBefore: iso(c.notBefore) } : {}),
    ...(c.notAfter ? { NotAfter: iso(c.notAfter) } : {}),
    KeyAlgorithm: c.keyAlgorithm,
    SignatureAlgorithm: 'SHA256WITHRSA',
    InUseBy: use,
    Type: kindOf(c),
    ...(c.Type === 'AMAZON_ISSUED' && c.Status === 'ISSUED' ? { RenewalEligibility: use.length ? 'ELIGIBLE' : 'INELIGIBLE' } : {}),
    ...(c.renewal ? { RenewalSummary: { RenewalStatus: c.renewal.status, DomainValidationOptions: dvo, UpdatedAt: iso(c.renewal.updated) } } : {}),
    Options: { CertificateTransparencyLoggingPreference: c.transparency },
    ...(c.Status === 'ISSUED' ? { KeyUsages: [{ Name: 'DIGITAL_SIGNATURE' }, { Name: 'KEY_ENCIPHERMENT' }], ExtendedKeyUsages: [{ Name: 'TLS_WEB_SERVER_AUTHENTICATION', OID: '1.3.6.1.5.5.7.3.1' }, { Name: 'TLS_WEB_CLIENT_AUTHENTICATION', OID: '1.3.6.1.5.5.7.3.2' }] } : {}),
  };
}

const NAME_RE = /^(\*\.)?([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;

function checkName(n: string): void {
  if (!NAME_RE.test(n) || n.length > 253 || n.includes('*', 1)) throw new AwsError('ValidationException', `1 validation error detected: Value '${n}' at 'domainName' failed to satisfy constraint: Member must satisfy regular expression pattern: ^(\\*\\.)?(((?!-)[A-Za-z0-9-]{0,62}[A-Za-z0-9])\\.)+((?!-)[A-Za-z0-9-]{1,62}[A-Za-z0-9])$`, 400);
  if (n.replace(/^\*\./, '').split('.')[0].length > 63) throw new AwsError('ValidationException', 'The domain name is too long.', 400);
}

// ───────────────────────── operaciones ─────────────────────────

op('acm', 'request-certificate', 'domain-name:s! validation-method:s subject-alternative-names:l idempotency-token:s options:f tags:f key-algorithm:s', 'Pide un certificado público gratuito. Para emitirlo hay que demostrar que el dominio es tuyo (por DNS, creando un CNAME).', { res: () => '*' }, (c) => {
  const domain = String(c.p.DomainName).toLowerCase();
  checkName(domain);
  const sans = toArr<string>(c.p.SubjectAlternativeNames).map((s) => s.toLowerCase());
  for (const s of sans) checkName(s);
  const method = String(c.p.ValidationMethod ?? 'EMAIL').toUpperCase();
  if (!['DNS', 'EMAIL'].includes(method)) throw new AwsError('ValidationException', `1 validation error detected: Value '${c.p.ValidationMethod}' at 'validationMethod' failed to satisfy constraint: Member must satisfy enum value set: [DNS, EMAIL, HTTP]`, 400);
  const all = [...new Set([domain, ...sans])];
  if (all.length > MAX_NAMES) throw new AwsError('LimitExceededException', `You have exceeded the limit of ${MAX_NAMES} domain names for this certificate.`, 400);
  const st = acmOf(c.acct, c.region);
  // con el mismo token se devuelve el mismo certificado (idempotencia)
  if (c.p.IdempotencyToken) {
    const dup = Object.values(st.certs).find((x) => x.token === c.p.IdempotencyToken && x.Domain === domain);
    if (dup) return { CertificateArn: dup.Arn };
  }
  const arn = mkArn('acm', c.region, c.acct.id, `certificate/${uuid(c.acct, 'acm')}`);
  const opt = Object.assign({}, ...toArr<Record<string, string>>(c.p.Options)) as { CertificateTransparencyLoggingPreference?: string };
  const cert: AcmCert = { Arn: arn, Domain: domain, Sans: all, Validation: method as 'DNS' | 'EMAIL', Status: 'PENDING_VALIDATION', Type: 'AMAZON_ISSUED', created: c.acct.clock, keyAlgorithm: String(c.p.KeyAlgorithm ?? 'RSA_2048').replace('_', '-'), token: c.p.IdempotencyToken, transparency: opt.CertificateTransparencyLoggingPreference === 'DISABLED' ? 'DISABLED' : 'ENABLED', Tags: toArr<{ Key: string; Value: string }>(c.p.Tags).map((t) => ({ Key: t.Key, Value: t.Value ?? '' })) };
  st.certs[arn] = cert;
  return { CertificateArn: arn };
});

op('acm', 'describe-certificate', 'certificate-arn:s!', 'Estado de un certificado, sus nombres, el registro CNAME que hay que crear y quién lo está usando.', { res: (c) => c.p.CertificateArn }, (c) => {
  const cert = findCert(c.acct, c.region, String(c.p.CertificateArn));
  settle(c.acct, c.region, cert);
  return { Certificate: view(c.acct, c.region, cert) };
});

op('acm', 'list-certificates', 'certificate-statuses:l includes:f max-items:i', 'Lista los certificados de la región (por defecto solo los emitidos o pendientes).', { res: () => '*', paginate: 'CertificateSummaryList' }, (c) => {
  const want = toArr<string>(c.p.CertificateStatuses);
  const list = Object.values(acmOf(c.acct, c.region).certs).filter((x) => (want.length ? want.includes(x.Status) : ['PENDING_VALIDATION', 'ISSUED'].includes(x.Status)));
  return { CertificateSummaryList: list.map((x) => ({ CertificateArn: x.Arn, DomainName: x.Domain, SubjectAlternativeNameSummaries: names(x), HasAdditionalSubjectAlternativeNames: false, Status: x.Status, Type: kindOf(x), KeyAlgorithm: x.keyAlgorithm, InUse: inUseBy(c.acct, c.region, x).length > 0, CreatedAt: iso(x.created), ...(x.issued ? { IssuedAt: iso(x.issued) } : {}), ...(x.notAfter ? { NotAfter: iso(x.notAfter) } : {}) })) };
});

op('acm', 'get-certificate', 'certificate-arn:s!', 'Devuelve el certificado y su cadena en formato PEM (solo cuando está emitido).', { res: (c) => c.p.CertificateArn }, (c) => {
  const cert = findCert(c.acct, c.region, String(c.p.CertificateArn));
  settle(c.acct, c.region, cert);
  if (cert.Status !== 'ISSUED') throw new AwsError('RequestInProgressException', `The certificate request is in progress (${cert.Status}). Retry the request later.`, 400);
  const pem = (what: string) => `-----BEGIN CERTIFICATE-----\n${stableId(`${what}:${cert.Arn}`, '', 64, 'b64')}\n${stableId(`${what}2:${cert.Arn}`, '', 64, 'b64')}\n-----END CERTIFICATE-----\n`;
  return { Certificate: pem('leaf'), CertificateChain: pem('chain') };
});

op('acm', 'delete-certificate', 'certificate-arn:s!', 'Borra un certificado. No se puede si lo usa un balanceador u otro servicio.', { res: (c) => c.p.CertificateArn }, (c) => {
  const cert = findCert(c.acct, c.region, String(c.p.CertificateArn));
  const use = inUseBy(c.acct, c.region, cert);
  if (use.length) throw new AwsError('ResourceInUseException', `Certificate ${cert.Arn} is in use by ${use.join(', ')}`, 400);
  delete acmOf(c.acct, c.region).certs[cert.Arn];
  return {};
});

op('acm', 'add-tags-to-certificate', 'certificate-arn:s! tags:f!', 'Etiqueta un certificado.', { res: (c) => c.p.CertificateArn }, (c) => {
  const cert = findCert(c.acct, c.region, String(c.p.CertificateArn));
  for (const t of toArr<{ Key: string; Value?: string }>(c.p.Tags)) {
    cert.Tags = cert.Tags.filter((x) => x.Key !== t.Key);
    cert.Tags.push({ Key: t.Key, Value: t.Value ?? '' });
  }
  return {};
});

op('acm', 'remove-tags-from-certificate', 'certificate-arn:s! tags:f!', 'Quita etiquetas de un certificado.', { res: (c) => c.p.CertificateArn }, (c) => {
  const cert = findCert(c.acct, c.region, String(c.p.CertificateArn));
  const del = new Set(toArr<{ Key: string }>(c.p.Tags).map((t) => t.Key));
  cert.Tags = cert.Tags.filter((t) => !del.has(t.Key));
  return {};
});

op('acm', 'list-tags-for-certificate', 'certificate-arn:s!', 'Lista las etiquetas de un certificado.', { res: (c) => c.p.CertificateArn }, (c) => ({ Tags: findCert(c.acct, c.region, String(c.p.CertificateArn)).Tags }));

op('acm', 'update-certificate-options', 'certificate-arn:s! options:f!', 'Cambia las opciones del certificado (registro en Certificate Transparency).', { res: (c) => c.p.CertificateArn }, (c) => {
  const cert = findCert(c.acct, c.region, String(c.p.CertificateArn));
  const opt = Object.assign({}, ...toArr<Record<string, string>>(c.p.Options)) as { CertificateTransparencyLoggingPreference?: string };
  if (opt.CertificateTransparencyLoggingPreference) cert.transparency = opt.CertificateTransparencyLoggingPreference === 'DISABLED' ? 'DISABLED' : 'ENABLED';
  return {};
});

op('acm', 'wait', 'waiter:s! certificate-arn:s!', 'Espera a que un certificado esté emitido (`certificate-validated`).', { positional: ['waiter'], res: () => '*', authz: false }, (c) => {
  const w = c.p.Waiter as string;
  if (w !== 'certificate-validated') throw new AwsError('InvalidWaiter', `Invalid choice: '${w}', valid choices are: certificate-validated`);
  for (let k = 0; k < 40; k++) {
    const cert = findCert(c.acct, c.region, String(c.p.CertificateArn));
    settle(c.acct, c.region, cert);
    if (cert.Status === 'ISSUED') return undefined;
    if (cert.Status !== 'PENDING_VALIDATION') throw new AwsError('WaiterError', `Waiter CertificateValidated failed: Waiter encountered a terminal failure state: certificate status is ${cert.Status}`, 255);
    c.acct.clock += 60000;
    tick(c.acct);
  }
  throw new AwsError('WaiterError', 'Waiter CertificateValidated failed: Max attempts exceeded', 255);
});

// ───────────────────────── el tiempo ─────────────────────────

/** Emisión, renovación y caducidad de un certificado. */
function settle(a: Account, region: string, c: AcmCert): void {
  if (c.Type === 'IMPORTED') {
    if (c.Status === 'ISSUED' && c.notAfter && a.clock >= c.notAfter) c.Status = 'EXPIRED';
    return;
  }
  if (c.Status === 'PENDING_VALIDATION') {
    if (c.Validation === 'DNS' && validated(a, c)) {
      c.Status = 'ISSUED';
      c.issued = a.clock;
      c.notBefore = a.clock;
      c.notAfter = a.clock + VALIDITY;
    } else if (a.clock - c.created > VALIDATION_WINDOW) c.Status = 'VALIDATION_TIMED_OUT';
    return;
  }
  if (c.Status !== 'ISSUED' || !c.notAfter) return;
  // renovación gestionada: 60 días antes de caducar, si lo usa un servicio y el registro CNAME sigue ahí
  if (a.clock >= c.notAfter - 60 * DAY) {
    const use = inUseBy(a, region, c).length > 0;
    if (use && validated(a, c)) {
      c.notBefore = a.clock;
      c.notAfter = a.clock + VALIDITY;
      c.renewal = { status: 'SUCCESS', updated: a.clock };
      return;
    }
    if (use) c.renewal = { status: 'PENDING_VALIDATION', updated: c.renewal?.updated ?? a.clock };
  }
  if (a.clock >= c.notAfter) c.Status = 'EXPIRED';
}

tickers.push((a) => {
  for (const [region, r] of Object.entries(a.regions)) for (const c of Object.values(r.acm?.certs ?? {})) settle(a, region, c);
});

// ───────────────────────── enganches ─────────────────────────

acmHooks.require = (a, region, arn) => {
  const c = acmOf(a, region).certs[arn];
  if (!c) throw new AwsError('CertificateNotFound', `Certificate '${arn}' not found`, 400);
  settle(a, region, c);
  if (c.Status !== 'ISSUED') throw new AwsError('UnsupportedCertificate', `The certificate '${arn}' is in ${c.Status} status: only ISSUED certificates can be used.`, 400);
};

acmHooks.covers = (a, region, arn, host) => {
  const c = acmOf(a, region).certs[arn];
  return !!c && c.Status === 'ISSUED' && covers(c, host);
};
