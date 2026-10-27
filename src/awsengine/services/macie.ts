/**
 * Amazon Macie: descubre datos sensibles en S3. Los trabajos de clasificación leen los objetos de texto de los buckets elegidos y
 * buscan identificadores gestionados (tarjetas, claves de AWS, DNI, IBAN…) o propios (regex + palabras clave); además, Macie vigila
 * cada bucket (público, compartido con otras cuentas, sin bloqueo de acceso público) y abre hallazgos de política.
 */
import { regional } from '../account';
import { AwsError, op, type OpCtx } from '../registry';
import { tickers } from '../tick';
import type { Account, S3Bucket } from '../types';
import type { MacieCustomId, MacieFinding, MacieJob, MacieState } from '../types-sec';
import { iso, isoZ, mkArn, newId, toArr } from '../util';
import { putEvent } from './events';
import { externalGrantees, statementsOf } from './secshared';
import { anonymousAllowed, s3Current } from './s3';

export const macieOf = (a: Account, region: string): MacieState => (regional(a, region).macie ??= { enabled: false, since: 0, frequency: 'FIFTEEN_MINUTES', jobs: {}, findings: {}, customIds: {}, filters: {} });

const val = (msg: string) => new AwsError('ValidationException', msg, 400);
const denied = () => new AwsError('AccessDeniedException', 'Macie is not enabled.', 403);

// ───────────────────────── identificadores gestionados ─────────────────────────

type Category = 'FINANCIAL_INFORMATION' | 'PERSONAL_INFORMATION' | 'CREDENTIALS' | 'CUSTOM_IDENTIFIER';

const luhn = (s: string): boolean => {
  const d = s.replace(/\D/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
};

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

interface Managed {
  id: string;
  category: Category;
  re: RegExp;
  check?: (m: string) => boolean;
}

export const MANAGED_IDS: Managed[] = [
  { id: 'CREDIT_CARD_NUMBER', category: 'FINANCIAL_INFORMATION', re: /\b(?:\d[ -]?){13,19}\b/g, check: luhn },
  { id: 'BANK_ACCOUNT_NUMBER', category: 'FINANCIAL_INFORMATION', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?\b/g, check: (m) => /^[A-Z]{2}\d{2}/.test(m) && m.replace(/ /g, '').length >= 15 },
  { id: 'AWS_CREDENTIALS', category: 'CREDENTIALS', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'OPENSSH_PRIVATE_KEY', category: 'CREDENTIALS', re: /-----BEGIN (?:OPENSSH|RSA|EC|DSA)? ?PRIVATE KEY-----/g },
  { id: 'SPAIN_DNI_NUMBER', category: 'PERSONAL_INFORMATION', re: /\b\d{8}[A-Z]\b/g, check: (m) => DNI_LETTERS[Number(m.slice(0, 8)) % 23] === m[8] },
  { id: 'USA_SOCIAL_SECURITY_NUMBER', category: 'PERSONAL_INFORMATION', re: /\b\d{3}-\d{2}-\d{4}\b/g },
];

/** Qué se encuentra en un texto. Devuelve cada identificador con el número de coincidencias. */
export function detect(text: string, custom: MacieCustomId[] = []): { type: string; category: Category; count: number }[] {
  const out: { type: string; category: Category; count: number }[] = [];
  for (const m of MANAGED_IDS) {
    const hits = (text.match(m.re) ?? []).filter((x) => !m.check || m.check(x));
    if (hits.length) out.push({ type: m.id, category: m.category, count: hits.length });
  }
  for (const c of custom) {
    let re: RegExp;
    try {
      re = new RegExp(c.Regex, 'g');
    } catch {
      continue;
    }
    const low = text.toLowerCase();
    if (c.Keywords.length && !c.Keywords.some((k) => low.includes(k.toLowerCase()))) continue;
    const hits = text.match(re) ?? [];
    if (hits.length) out.push({ type: c.Name, category: 'CUSTOM_IDENTIFIER', count: hits.length });
  }
  return out;
}

const TEXT_TYPE = /(text|json|csv|xml|yaml|x-sh|javascript|sql|log)/i;
const classifiable = (key: string, contentType: string) => TEXT_TYPE.test(contentType) || /\.(txt|csv|json|log|xml|ya?ml|sql|md|env|conf|ini|pem|key)$/i.test(key);

// ───────────────────────── hallazgos ─────────────────────────

const SCORE = { Low: 1, Medium: 2, High: 3 } as const;

function addFinding(a: Account, region: string, st: MacieState, f: Omit<MacieFinding, 'id' | 'createdAt' | 'archived'>): MacieFinding {
  const id = newId(a, 'maciefinding', '', 32, 'hex');
  const x: MacieFinding = { ...f, id, createdAt: a.clock, archived: false };
  // un filtro ARCHIVE (regla de supresión) archiva el hallazgo al nacer
  if (Object.values(st.filters).some((fl) => fl.action === 'ARCHIVE' && matches(x, fl.criteria as never))) x.archived = true;
  st.findings[id] = x;
  try {
    putEvent(a, region, 'default', { source: 'aws.macie', detailType: 'Macie Finding', resources: [], detail: view(a, region, x) });
  } catch {
    /* sin reglas */
  }
  return x;
}

function view(a: Account, region: string, f: MacieFinding) {
  const b = a.s3.buckets[f.bucket];
  const base = {
    accountId: a.id,
    archived: f.archived,
    category: f.category,
    count: f.count,
    createdAt: isoZ(f.createdAt),
    description: f.description,
    id: f.id,
    partition: 'aws',
    region,
    resourcesAffected: { s3Bucket: { arn: `arn:aws:s3:::${f.bucket}`, name: f.bucket, createdAt: b?.created, owner: { id: a.id }, publicAccess: { effectivePermission: b && anonymousAllowed(b, 's3:GetObject', `arn:aws:s3:::${f.bucket}/x`) ? 'PUBLIC' : 'NOT_PUBLIC' }, defaultServerSideEncryption: { encryptionType: b?.encryption.SSEAlgorithm === 'aws:kms' ? 'aws:kms' : 'AES256' } }, ...(f.key ? { s3Object: { bucketArn: `arn:aws:s3:::${f.bucket}`, key: f.key, path: `${f.bucket}/${f.key}`, size: 0, storageClass: 'STANDARD' } } : {}) },
    sample: false,
    severity: { description: f.severity, score: SCORE[f.severity] },
    title: f.description.split('.')[0],
    type: f.type,
    updatedAt: isoZ(f.createdAt),
  };
  if (f.category === 'POLICY') return { ...base, policyDetails: { action: { actionType: 'AWS_API_CALL', apiCallDetails: { api: 'PutBucketPolicy', apiServiceName: 's3.amazonaws.com' } }, actor: { userIdentity: { type: 'IAMUser' } } } };
  return {
    ...base,
    classificationDetails: {
      jobArn: f.jobId ? mkArn('macie2', region, a.id, `classification-job/${f.jobId}`) : undefined,
      jobId: f.jobId,
      result: {
        status: { code: 'COMPLETE' },
        mimeType: 'text/plain',
        sizeClassified: 0,
        sensitiveData: Object.values(
          f.detections.reduce<Record<string, { category: string; totalCount: number; detections: { type: string; count: number }[] }>>((m, d) => {
            const cat = d.type === 'AWS_CREDENTIALS' || d.type === 'OPENSSH_PRIVATE_KEY' ? 'CREDENTIALS' : d.type === 'CREDIT_CARD_NUMBER' || d.type === 'BANK_ACCOUNT_NUMBER' ? 'FINANCIAL_INFORMATION' : MANAGED_IDS.some((x) => x.id === d.type) ? 'PERSONAL_INFORMATION' : 'CUSTOM_IDENTIFIER';
            (m[cat] ??= { category: cat, totalCount: 0, detections: [] }).totalCount += d.count;
            m[cat].detections.push({ type: d.type, count: d.count });
            return m;
          }, {}),
        ),
        customDataIdentifiers: { totalCount: 0, detections: [] },
      },
    },
  };
}

const isExternal = (a: Account, b: S3Bucket): boolean => statementsOf(b.policy).some((s) => externalGrantees(a, s).some((g) => g.type === 'account'));
const isPublic = (b: S3Bucket): boolean => anonymousAllowed(b, 's3:GetObject', `arn:aws:s3:::${b.name}/x`) || anonymousAllowed(b, 's3:ListBucket', `arn:aws:s3:::${b.name}`);
const pabOff = (b: S3Bucket): boolean => !b.publicAccessBlock || !(b.publicAccessBlock.BlockPublicAcls && b.publicAccessBlock.IgnorePublicAcls && b.publicAccessBlock.BlockPublicPolicy && b.publicAccessBlock.RestrictPublicBuckets);

/** Vigilancia automática de buckets: abre los hallazgos de política y archiva los que dejan de cumplirse. */
function policyScan(a: Account, region: string, st: MacieState): void {
  const rules: [string, 'Low' | 'Medium' | 'High', (b: S3Bucket) => boolean, (b: string) => string][] = [
    ['Policy:IAMUser/S3BucketPublic', 'High', isPublic, (b) => `The S3 bucket ${b} is publicly accessible.`],
    ['Policy:IAMUser/S3BucketSharedExternally', 'Medium', (b) => isExternal(a, b), (b) => `The S3 bucket ${b} is shared with an AWS account that is not part of this account.`],
    ['Policy:IAMUser/S3BlockPublicAccessDisabled', 'Low', pabOff, (b) => `Block Public Access is disabled for the S3 bucket ${b}.`],
  ];
  for (const b of Object.values(a.s3.buckets)) {
    if (b.region !== region) continue;
    for (const [type, severity, test, text] of rules) {
      const open = Object.values(st.findings).find((f) => f.type === type && f.bucket === b.name && !f.archived);
      if (test(b)) {
        if (!open) addFinding(a, region, st, { type, category: 'POLICY', severity, bucket: b.name, count: 1, description: text(b.name), detections: [] });
      } else if (open) open.archived = true;
    }
  }
}

// ───────────────────────── trabajos de clasificación ─────────────────────────

function candidates(a: Account, job: MacieJob): { bucket: S3Bucket; key: string; body: string }[] {
  const out: { bucket: S3Bucket; key: string; body: string }[] = [];
  for (const name of job.buckets) {
    const b = a.s3.buckets[name];
    if (!b) continue;
    for (const key of Object.keys(b.objects).sort()) {
      const v = s3Current(b, key);
      if (v && classifiable(key, v.contentType)) out.push({ bucket: b, key, body: v.body });
    }
  }
  const n = Math.ceil((out.length * job.samplingPercentage) / 100);
  return out.slice(0, n);
}

function objectCount(a: Account, job: MacieJob): number {
  return job.buckets.reduce((n, name) => n + Object.keys(a.s3.buckets[name]?.objects ?? {}).filter((k) => s3Current(a.s3.buckets[name], k)).length, 0);
}

const duration = (a: Account, job: MacieJob) => Math.min(600000, 60000 + objectCount(a, job) * 1000);

function runJob(a: Account, region: string, st: MacieState, job: MacieJob): void {
  const custom = job.customIdentifierIds.map((i) => st.customIds[i]).filter((x): x is MacieCustomId => !!x);
  const all = candidates(a, job);
  job.stats = { objects: objectCount(a, job), classified: all.length, bytes: all.reduce((n, o) => n + o.body.length, 0) };
  for (const o of all) {
    const det = detect(o.body, custom);
    if (!det.length) continue;
    const cats = new Set(det.map((d) => d.category));
    const total = det.reduce((n, d) => n + d.count, 0);
    const kind = cats.size > 1 ? 'Multiple' : cats.has('CREDENTIALS') ? 'Credentials' : cats.has('FINANCIAL_INFORMATION') ? 'Financial' : cats.has('PERSONAL_INFORMATION') ? 'Personal' : 'CustomIdentifier';
    const severity: MacieFinding['severity'] = kind === 'Multiple' || kind === 'Credentials' || kind === 'Financial' ? 'High' : total >= 5 ? 'High' : 'Medium';
    addFinding(a, region, st, { type: `SensitiveData:S3Object/${kind}`, category: 'CLASSIFICATION', severity, bucket: o.bucket.name, key: o.key, count: 1, description: `The object contains ${total} sensitive data occurrence${total === 1 ? '' : 's'} (${det.map((d) => d.type).join(', ')}).`, detections: det.map((d) => ({ type: d.type, count: d.count })), jobId: job.jobId });
  }
  job.status = 'COMPLETE';
  job.finishedAt = a.clock;
}

tickers.push((a) => {
  for (const [region, rs] of Object.entries(a.regions)) {
    const st = rs.macie;
    if (!st?.enabled) continue;
    policyScan(a, region, st);
    for (const job of Object.values(st.jobs)) if (job.status === 'RUNNING' && a.clock >= job.created + duration(a, job)) runJob(a, region, st, job);
  }
});

// ───────────────────────── sesión ─────────────────────────

const session = (a: Account, st: MacieState) => ({ createdAt: isoZ(st.since), findingPublishingFrequency: st.frequency, serviceRole: `arn:aws:iam::${a.id}:role/aws-service-role/macie.amazonaws.com/AWSServiceRoleForAmazonMacie`, status: st.enabled ? 'ENABLED' : 'PAUSED', updatedAt: isoZ(st.since) });

const FREQ = ['FIFTEEN_MINUTES', 'ONE_HOUR', 'SIX_HOURS'];
const need = (c: OpCtx): MacieState => {
  const st = macieOf(c.acct, c.region);
  if (!st.enabled) throw denied();
  return st;
};

op('macie2', 'enable-macie', 'client-token:s finding-publishing-frequency:s status:s', 'Activa Macie en esta región.', { api: 'EnableMacie', res: () => '*' }, (c) => {
  const st = macieOf(c.acct, c.region);
  if (st.since) throw new AwsError('ConflictException', 'Macie is already enabled.', 409);
  if (c.p.FindingPublishingFrequency && !FREQ.includes(String(c.p.FindingPublishingFrequency))) throw val('findingPublishingFrequency must be FIFTEEN_MINUTES, ONE_HOUR or SIX_HOURS');
  st.enabled = c.p.Status !== 'PAUSED';
  st.since = c.acct.clock;
  st.frequency = String(c.p.FindingPublishingFrequency ?? 'FIFTEEN_MINUTES');
  return {};
});
op('macie2', 'disable-macie', '', 'Desactiva Macie y borra sus hallazgos y trabajos.', { api: 'DisableMacie', res: () => '*' }, (c) => {
  need(c);
  const r = regional(c.acct, c.region);
  r.macie = { enabled: false, since: 0, frequency: 'FIFTEEN_MINUTES', jobs: {}, findings: {}, customIds: {}, filters: {} };
  return {};
});
op('macie2', 'get-macie-session', '', 'Estado de Macie en la región.', { api: 'GetMacieSession', res: () => '*' }, (c) => {
  const st = macieOf(c.acct, c.region);
  if (!st.since) throw denied();
  return session(c.acct, st);
});
op('macie2', 'update-macie-session', 'finding-publishing-frequency:s status:s', 'Pausa o reanuda Macie y cambia la frecuencia de publicación.', { api: 'UpdateMacieSession', res: () => '*' }, (c) => {
  const st = macieOf(c.acct, c.region);
  if (!st.since) throw denied();
  if (c.p.Status) st.enabled = c.p.Status === 'ENABLED';
  if (c.p.FindingPublishingFrequency) st.frequency = String(c.p.FindingPublishingFrequency);
  return {};
});

// ───────────────────────── trabajos ─────────────────────────

const jobArn = (c: Pick<OpCtx, 'acct' | 'region'>, id: string) => mkArn('macie2', c.region, c.acct.id, `classification-job/${id}`);

const jView = (c: OpCtx, j: MacieJob) => ({
  jobId: j.jobId,
  jobArn: j.jobArn,
  name: j.name,
  jobType: j.jobType,
  jobStatus: j.status,
  createdAt: isoZ(j.created),
  ...(j.finishedAt ? { lastRunTime: isoZ(j.finishedAt) } : {}),
  description: j.description,
  samplingPercentage: j.samplingPercentage,
  customDataIdentifierIds: j.customIdentifierIds,
  managedDataIdentifierSelector: 'ALL',
  s3JobDefinition: { bucketDefinitions: [{ accountId: c.acct.id, buckets: j.buckets }] },
  statistics: { approximateNumberOfObjectsToProcess: j.status === 'COMPLETE' ? 0 : objectCount(c.acct, j), numberOfRuns: j.status === 'COMPLETE' ? 1 : 0 },
  initialRun: false,
  lastRunErrorStatus: { code: 'NONE' },
  tags: {},
});

op('macie2', 'create-classification-job', 'job-type:s! name:s! s3-job-definition:j! custom-data-identifier-ids:l description:s sampling-percentage:i managed-data-identifier-selector:s managed-data-identifier-ids:l allow-list-ids:l schedule-frequency:j initial-run:b client-token:s tags:j', 'Lanza un trabajo que lee los objetos de unos buckets y busca datos sensibles.', { api: 'CreateClassificationJob', res: () => '*' }, (c) => {
  const st = need(c);
  const type = String(c.p.JobType);
  if (!['ONE_TIME', 'SCHEDULED'].includes(type)) throw val('jobType must be ONE_TIME or SCHEDULED');
  const def = c.p.S3JobDefinition as { bucketDefinitions?: { accountId?: string; buckets?: string[] }[] };
  const buckets = (def.bucketDefinitions ?? []).flatMap((d) => toArr(d.buckets));
  if (!buckets.length) throw val('s3JobDefinition must include at least one bucket');
  for (const b of buckets) {
    const bk = c.acct.s3.buckets[b];
    if (!bk) throw val(`The bucket ${b} does not exist or is not accessible.`);
    if (bk.region !== c.region) throw val(`The bucket ${b} is in ${bk.region}, not in ${c.region}: create the job in the bucket's region.`);
  }
  const custom = toArr<string>(c.p.CustomDataIdentifierIds);
  for (const i of custom) if (!st.customIds[i]) throw new AwsError('ResourceNotFoundException', `The custom data identifier ${i} does not exist.`, 404);
  const pct = Number(c.p.SamplingPercentage ?? 100);
  if (!Number.isInteger(pct) || pct < 1 || pct > 100) throw val('samplingPercentage must be between 1 and 100');
  const id = newId(c.acct, 'maciejob', '', 32, 'hex');
  st.jobs[id] = { jobId: id, jobArn: jobArn(c, id), name: String(c.p.Name), jobType: type as 'ONE_TIME' | 'SCHEDULED', status: 'RUNNING', buckets, created: c.acct.clock, customIdentifierIds: custom, stats: { objects: 0, classified: 0, bytes: 0 }, samplingPercentage: pct, description: c.p.Description ?? '' };
  return { jobArn: jobArn(c, id), jobId: id };
});
op('macie2', 'describe-classification-job', 'job-id:s!', 'Estado y estadísticas de un trabajo.', { api: 'DescribeClassificationJob', res: () => '*' }, (c) => {
  const j = need(c).jobs[String(c.p.JobId)];
  if (!j) throw new AwsError('ResourceNotFoundException', 'The classification job does not exist.', 404);
  return jView(c, j);
});
op('macie2', 'list-classification-jobs', 'filter-criteria:j sort-criteria:j max-results:i next-token:s', 'Lista los trabajos.', { api: 'ListClassificationJobs', res: () => '*' }, (c) => ({ items: Object.values(need(c).jobs).map((j) => ({ jobId: j.jobId, name: j.name, jobType: j.jobType, jobStatus: j.status, createdAt: isoZ(j.created), bucketDefinitions: [{ accountId: c.acct.id, buckets: j.buckets }], userPausedDetails: {} })) }));
op('macie2', 'update-classification-job', 'job-id:s! job-status:s!', 'Cancela (CANCELLED), pausa (USER_PAUSED) o reanuda (RUNNING) un trabajo.', { api: 'UpdateClassificationJob', res: () => '*' }, (c) => {
  const j = need(c).jobs[String(c.p.JobId)];
  if (!j) throw new AwsError('ResourceNotFoundException', 'The classification job does not exist.', 404);
  const s = String(c.p.JobStatus);
  if (!['CANCELLED', 'USER_PAUSED', 'RUNNING'].includes(s)) throw val('jobStatus must be CANCELLED, USER_PAUSED or RUNNING');
  if (j.status === 'COMPLETE' || j.status === 'CANCELLED') throw new AwsError('ConflictException', `The job is ${j.status} and cannot be changed.`, 409);
  j.status = s === 'USER_PAUSED' ? 'PAUSED' : (s as MacieJob['status']);
  return {};
});

// ───────────────────────── identificadores propios ─────────────────────────

op('macie2', 'list-managed-data-identifiers', 'next-token:s', 'Los identificadores gestionados que Macie sabe buscar.', { api: 'ListManagedDataIdentifiers', res: () => '*' }, () => ({ items: MANAGED_IDS.map((m) => ({ id: m.id, category: m.category })) }));

op('macie2', 'create-custom-data-identifier', 'name:s! regex:s! keywords:l ignore-words:l maximum-match-distance:i description:s severity-levels:j client-token:s tags:j', 'Crea un identificador propio: una expresión regular (con palabras clave opcionales cerca).', { api: 'CreateCustomDataIdentifier', res: () => '*' }, (c) => {
  const st = need(c);
  try {
    new RegExp(String(c.p.Regex));
  } catch {
    throw val('The regular expression is not valid.');
  }
  const id = newId(c.acct, 'maciecdi', '', 32, 'hex');
  st.customIds[id] = { Id: id, Name: String(c.p.Name), Regex: String(c.p.Regex), Keywords: toArr<string>(c.p.Keywords), Description: c.p.Description ?? '', created: c.acct.clock };
  return { customDataIdentifierId: id };
});
op('macie2', 'list-custom-data-identifiers', 'max-results:i next-token:s', 'Lista los identificadores propios.', { api: 'ListCustomDataIdentifiers', res: () => '*' }, (c) => ({ items: Object.values(need(c).customIds).map((x) => ({ id: x.Id, name: x.Name, description: x.Description, createdAt: isoZ(x.created), arn: mkArn('macie2', c.region, c.acct.id, `custom-data-identifier/${x.Id}`) })) }));
op('macie2', 'get-custom-data-identifier', 'id:s!', 'Un identificador propio.', { api: 'GetCustomDataIdentifier', res: () => '*' }, (c) => {
  const x = need(c).customIds[String(c.p.Id)];
  if (!x) throw new AwsError('ResourceNotFoundException', 'The custom data identifier does not exist.', 404);
  return { id: x.Id, name: x.Name, regex: x.Regex, keywords: x.Keywords, description: x.Description, createdAt: isoZ(x.created), deleted: false, maximumMatchDistance: 50 };
});
op('macie2', 'delete-custom-data-identifier', 'id:s!', 'Borra un identificador propio.', { api: 'DeleteCustomDataIdentifier', res: () => '*' }, (c) => {
  const st = need(c);
  if (!st.customIds[String(c.p.Id)]) throw new AwsError('ResourceNotFoundException', 'The custom data identifier does not exist.', 404);
  delete st.customIds[String(c.p.Id)];
  return {};
});
op('macie2', 'test-custom-data-identifier', 'regex:s! sample-text:s! keywords:l ignore-words:l maximum-match-distance:i', 'Prueba una expresión regular contra un texto de muestra.', { api: 'TestCustomDataIdentifier', res: () => '*' }, (c) => {
  let re: RegExp;
  try {
    re = new RegExp(String(c.p.Regex), 'g');
  } catch {
    throw val('The regular expression is not valid.');
  }
  const kw = toArr<string>(c.p.Keywords);
  const text = String(c.p.SampleText);
  if (kw.length && !kw.some((k) => text.toLowerCase().includes(k.toLowerCase()))) return { matchCount: 0 };
  return { matchCount: (text.match(re) ?? []).length };
});

// ───────────────────────── hallazgos ─────────────────────────

const attr = (f: MacieFinding, name: string): (string | number)[] => {
  const map: Record<string, unknown> = { type: f.type, category: f.category, 'severity.description': f.severity, archived: String(f.archived), 'resourcesAffected.s3Bucket.name': f.bucket, 'resourcesAffected.s3Object.key': f.key, 'classificationDetails.jobId': f.jobId, id: f.id, createdAt: f.createdAt, updatedAt: f.createdAt, count: f.count };
  const v = map[name];
  return v === undefined ? [] : toArr(v as string | number);
};

function matches(f: MacieFinding, crit: { criterion?: Record<string, { eq?: string[]; neq?: string[]; gt?: number; gte?: number; lt?: number; lte?: number }> } | undefined): boolean {
  return Object.entries(crit?.criterion ?? {}).every(([name, cond]) => {
    const have = attr(f, name);
    const has = (x: string) => have.some((h) => String(h) === String(x));
    if (cond.eq && !cond.eq.some(has)) return false;
    if (cond.neq && cond.neq.some(has)) return false;
    if (cond.gt !== undefined && !have.some((h) => Number(h) > cond.gt!)) return false;
    if (cond.gte !== undefined && !have.some((h) => Number(h) >= cond.gte!)) return false;
    if (cond.lt !== undefined && !have.some((h) => Number(h) < cond.lt!)) return false;
    if (cond.lte !== undefined && !have.some((h) => Number(h) <= cond.lte!)) return false;
    return true;
  });
}

op('macie2', 'list-findings', 'finding-criteria:j sort-criteria:j max-results:i next-token:s', 'Los ids de los hallazgos de Macie que cumplen unos criterios.', { api: 'ListFindings', res: () => '*' }, (c) => {
  const st = need(c);
  const list = Object.values(st.findings).filter((f) => matches(f, c.p.FindingCriteria as never));
  list.sort((x, y) => y.createdAt - x.createdAt);
  return { findingIds: list.slice(0, Number(c.p.MaxResults ?? 50)).map((f) => f.id) };
});
op('macie2', 'get-findings', 'finding-ids:l! sort-criteria:j', 'Detalle de hallazgos de Macie.', { api: 'GetFindings', res: () => '*' }, (c) => {
  const st = need(c);
  return { findings: toArr<string>(c.p.FindingIds).map((i) => st.findings[i]).filter((f): f is MacieFinding => !!f).map((f) => view(c.acct, c.region, f)) };
});
op('macie2', 'get-finding-statistics', 'group-by:s! finding-criteria:j size:i sort-criteria:j', 'Cuenta los hallazgos por tipo o gravedad.', { api: 'GetFindingStatistics', res: () => '*' }, (c) => {
  const st = need(c);
  const by = new Map<string, number>();
  for (const f of Object.values(st.findings).filter((x) => matches(x, c.p.FindingCriteria as never))) {
    const k = String(attr(f, String(c.p.GroupBy))[0] ?? 'unknown');
    by.set(k, (by.get(k) ?? 0) + 1);
  }
  return { countsByGroup: [...by.entries()].map(([groupKey, count]) => ({ groupKey, count })) };
});
op('macie2', 'create-findings-filter', 'action:s! finding-criteria:j! name:s! description:s position:i client-token:s tags:j', 'Crea un filtro; con ARCHIVE funciona como regla de supresión (archiva los hallazgos que coinciden).', { api: 'CreateFindingsFilter', res: () => '*' }, (c) => {
  const st = need(c);
  const action = String(c.p.Action);
  if (!['ARCHIVE', 'NOOP'].includes(action)) throw val('action must be ARCHIVE or NOOP');
  if (Object.values(st.filters).some((f) => f.name === c.p.Name)) throw new AwsError('ConflictException', 'A filter with that name already exists.', 409);
  const id = newId(c.acct, 'maciefilter', '', 32, 'hex');
  st.filters[id] = { id, name: String(c.p.Name), action: action as 'ARCHIVE' | 'NOOP', position: Number(c.p.Position ?? 1), description: c.p.Description ?? '', criteria: c.p.FindingCriteria as Record<string, any> };
  if (action === 'ARCHIVE') for (const f of Object.values(st.findings)) if (matches(f, st.filters[id].criteria as never)) f.archived = true;
  return { arn: mkArn('macie2', c.region, c.acct.id, `findings-filter/${id}`), id };
});
op('macie2', 'list-findings-filters', 'max-results:i next-token:s', 'Lista los filtros de hallazgos.', { api: 'ListFindingsFilters', res: () => '*' }, (c) => ({ findingsFilterListItems: Object.values(need(c).filters).map((f) => ({ id: f.id, name: f.name, action: f.action, arn: mkArn('macie2', c.region, c.acct.id, `findings-filter/${f.id}`) })) }));
op('macie2', 'delete-findings-filter', 'id:s!', 'Borra un filtro de hallazgos.', { api: 'DeleteFindingsFilter', res: () => '*' }, (c) => {
  const st = need(c);
  if (!st.filters[String(c.p.Id)]) throw new AwsError('ResourceNotFoundException', 'The findings filter does not exist.', 404);
  delete st.filters[String(c.p.Id)];
  return {};
});

// ───────────────────────── inventario de buckets ─────────────────────────

const bucketView = (c: OpCtx, b: S3Bucket, st: MacieState) => {
  const objs = Object.keys(b.objects).filter((k) => s3Current(b, k));
  const size = objs.reduce((n, k) => n + (s3Current(b, k)?.size ?? 0), 0);
  const cls = objs.filter((k) => classifiable(k, s3Current(b, k)!.contentType));
  const job = Object.values(st.jobs).filter((j) => j.buckets.includes(b.name)).sort((x, y) => y.created - x.created)[0];
  const pub = isPublic(b);
  return {
    accountId: c.acct.id,
    bucketArn: `arn:aws:s3:::${b.name}`,
    bucketCreatedAt: b.created,
    bucketName: b.name,
    classifiableObjectCount: cls.length,
    classifiableSizeInBytes: cls.reduce((n, k) => n + (s3Current(b, k)?.size ?? 0), 0),
    jobDetails: { isDefinedInJob: job ? 'TRUE' : 'FALSE', isMonitoredByJob: job && job.status === 'RUNNING' ? 'TRUE' : 'FALSE', ...(job ? { lastJobId: job.jobId, ...(job.finishedAt ? { lastJobRunTime: isoZ(job.finishedAt) } : {}) } : {}) },
    lastUpdated: iso(c.acct.clock),
    objectCount: objs.length,
    objectCountByEncryptionType: { customerManaged: objs.filter((k) => s3Current(b, k)?.sse === 'aws:kms' && s3Current(b, k)?.ssekmsKeyId && !s3Current(b, k)?.ssekmsKeyId?.includes('alias/aws')).length, kmsManaged: 0, s3Managed: objs.length, unencrypted: 0, unknown: 0 },
    publicAccess: { effectivePermission: pub ? 'PUBLIC' : 'NOT_PUBLIC', permissionConfiguration: { bucketLevelPermissions: { blockPublicAccess: { blockPublicAcls: !!b.publicAccessBlock?.BlockPublicAcls, blockPublicPolicy: !!b.publicAccessBlock?.BlockPublicPolicy, ignorePublicAcls: !!b.publicAccessBlock?.IgnorePublicAcls, restrictPublicBuckets: !!b.publicAccessBlock?.RestrictPublicBuckets }, bucketPolicy: { allowsPublicReadAccess: pub, allowsPublicWriteAccess: false } } } },
    region: b.region,
    sensitivityScore: 50,
    sharedAccess: isExternal(c.acct, b) ? 'EXTERNAL' : 'NOT_SHARED',
    sizeInBytes: size,
    sizeInBytesCompressed: 0,
    tags: b.tags.map((t) => ({ key: t.Key, value: t.Value })),
    unclassifiableObjectCount: { fileType: objs.length - cls.length, total: objs.length - cls.length },
    versioning: b.versioning === 'Enabled',
  };
};

op('macie2', 'describe-buckets', 'criteria:j sort-criteria:j max-results:i next-token:s', 'Inventario de los buckets de la región: si son públicos, se comparten, tienen datos clasificables…', { api: 'DescribeBuckets', res: () => '*' }, (c) => {
  const st = need(c);
  return { buckets: Object.values(c.acct.s3.buckets).filter((b) => b.region === c.region).map((b) => bucketView(c, b, st)) };
});
op('macie2', 'get-bucket-statistics', 'account-id:s', 'Cifras globales del inventario de buckets.', { api: 'GetBucketStatistics', res: () => '*' }, (c) => {
  const st = need(c);
  const bs = Object.values(c.acct.s3.buckets).filter((b) => b.region === c.region).map((b) => bucketView(c, b, st));
  const n = (f: (b: ReturnType<typeof bucketView>) => boolean) => bs.filter(f).length;
  return {
    bucketCount: bs.length,
    bucketCountByEffectivePermission: { publiclyAccessible: n((b) => b.publicAccess.effectivePermission === 'PUBLIC'), publiclyReadable: n((b) => b.publicAccess.effectivePermission === 'PUBLIC'), publiclyWritable: 0, unknown: 0 },
    bucketCountByEncryptionType: { kmsManaged: 0, s3Managed: bs.length, unencrypted: 0, unknown: 0 },
    bucketCountBySharedAccessType: { external: n((b) => b.sharedAccess === 'EXTERNAL'), internal: 0, notShared: n((b) => b.sharedAccess === 'NOT_SHARED'), unknown: 0 },
    classifiableObjectCount: bs.reduce((s, b) => s + b.classifiableObjectCount, 0),
    classifiableSizeInBytes: bs.reduce((s, b) => s + b.classifiableSizeInBytes, 0),
    objectCount: bs.reduce((s, b) => s + b.objectCount, 0),
    sizeInBytes: bs.reduce((s, b) => s + b.sizeInBytes, 0),
    lastUpdated: iso(c.acct.clock),
  };
});

/** `_check macie`: resumen para el corrector. */
op('_check', 'macie', 'region:s', 'Resumen de Macie: sesión, trabajos y hallazgos abiertos por tipo.', { global: true, authz: false, anon: true }, (c) => {
  const out: Record<string, unknown> = {};
  for (const [region, rs] of Object.entries(c.acct.regions)) {
    if (!rs.macie?.since || (c.p.Region && c.p.Region !== region)) continue;
    const open = Object.values(rs.macie.findings).filter((f) => !f.archived);
    out[region] = { Enabled: rs.macie.enabled, Jobs: Object.values(rs.macie.jobs).map((j) => ({ Name: j.name, Status: j.status, Buckets: j.buckets })), Open: open.length, Types: [...new Set(open.map((f) => f.type))].sort(), Objects: open.filter((f) => f.category === 'CLASSIFICATION').map((f) => `${f.bucket}/${f.key}`).sort() };
  }
  return out;
});
