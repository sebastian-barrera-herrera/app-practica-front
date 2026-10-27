/**
 * Amazon Inspector (v2): busca vulnerabilidades de paquetes en instancias EC2 (necesita el agente de Systems Manager) y en imágenes de ECR,
 * y alcanzabilidad de red (puertos de administración o de bases de datos visibles desde internet). Los hallazgos se calculan de lo que
 * hay en la cuenta en cada momento: se cierran solos al parchear o al cerrar el puerto.
 */
import { regional } from '../account';
import { scanPackages } from '../containers/catalog';
import { traceFromInternet } from '../net';
import { AwsError, op, type OpCtx } from '../registry';
import { tickers } from '../tick';
import type { Account, Ec2Instance } from '../types';
import type { InspFilter, InspState } from '../types-sec';
import { iso, mkArn, stableId, toArr } from '../util';
import { ecrOf } from './ecr';
import { putEvent } from './events';
import { ssmStatus } from './ssm';
import { unpatchedCves } from './ssmpatch';

export const inspOf = (a: Account, region: string): InspState => (regional(a, region).inspector2 ??= { enabled: { EC2: false, ECR: false, LAMBDA: false }, since: 0, filters: {}, seen: {}, lastScan: -1 });

const TYPES = ['EC2', 'ECR', 'LAMBDA'] as const;
type RType = (typeof TYPES)[number];
const SEV_SCORE: Record<string, number> = { CRITICAL: 9.8, HIGH: 7.8, MEDIUM: 5.5, LOW: 3.1, INFORMATIONAL: 0 };
const SEV_OF_PATCH: Record<string, string> = { Critical: 'CRITICAL', Important: 'HIGH', Medium: 'MEDIUM', Low: 'LOW' };
const RISKY: [number, string, string][] = [
  [22, 'MEDIUM', 'SSH'],
  [3389, 'MEDIUM', 'RDP'],
  [3306, 'HIGH', 'MySQL'],
  [5432, 'HIGH', 'PostgreSQL'],
  [6379, 'HIGH', 'Redis'],
  [27017, 'HIGH', 'MongoDB'],
];

const val = (msg: string) => new AwsError('ValidationException', msg, 400);

export interface InspFinding {
  findingArn: string;
  awsAccountId: string;
  type: 'PACKAGE_VULNERABILITY' | 'NETWORK_REACHABILITY';
  title: string;
  description: string;
  severity: string;
  status: 'ACTIVE' | 'SUPPRESSED' | 'CLOSED';
  firstObservedAt: string;
  lastObservedAt: string;
  updatedAt: string;
  inspectorScore?: number;
  exploitAvailable?: 'YES' | 'NO';
  fixAvailable?: 'YES' | 'NO' | 'PARTIAL';
  remediation: { recommendation: { text: string; Url?: string } };
  resources: Record<string, any>[];
  packageVulnerabilityDetails?: Record<string, any>;
  networkReachabilityDetails?: Record<string, any>;
  /** Para filtrar y agregar. */
  meta: { resourceType: string; resourceId: string; vulnerabilityId?: string; packageName?: string; port?: number; repository?: string; key: string };
}

const tagsOf = (i: Ec2Instance) => Object.fromEntries(i.Tags.map((t) => [t.Key, t.Value]));

function ec2Resource(a: Account, region: string, i: Ec2Instance) {
  return { id: i.InstanceId, type: 'AWS_EC2_INSTANCE', region, partition: 'aws', tags: tagsOf(i), details: { awsEc2Instance: { type: i.InstanceType, imageId: i.ImageId, ipV4Addresses: [i.PublicIpAddress, i.PrivateIpAddress].filter(Boolean), keyName: i.KeyName, iamInstanceProfileArn: i.IamInstanceProfile, vpcId: i.VpcId, subnetId: i.SubnetId, launchedAt: i.LaunchTime, platform: 'AMAZON_LINUX_2023' } } };
}

/** Todos los hallazgos que existen ahora mismo (sin estado de supresión). */
function compute(a: Account, region: string, st: InspState): Omit<InspFinding, 'status' | 'firstObservedAt' | 'lastObservedAt' | 'updatedAt'>[] {
  const out: Omit<InspFinding, 'status' | 'firstObservedAt' | 'lastObservedAt' | 'updatedAt'>[] = [];
  const mk = (key: string): string => mkArn('inspector2', region, a.id, `finding/${stableId('insp:' + key, '', 32, 'hex')}`);
  const r = regional(a, region).ec2;
  if (st.enabled.EC2) {
    for (const i of Object.values(r.instances)) {
      if (i.state !== 'running') continue;
      // alcanzabilidad de red: no necesita agente
      for (const [port, severity, name] of RISKY) {
        if (!traceFromInternet(a, r, i, 'tcp', port, '198.51.100.66').reachable) continue;
        const key = `net|${i.InstanceId}|${port}`;
        out.push({
          findingArn: mk(key),
          awsAccountId: a.id,
          type: 'NETWORK_REACHABILITY',
          title: `Port ${port} is reachable from an Internet Gateway - TCP`,
          description: `On the ENI ${i.InstanceId}, the port ${port} (${name}) is reachable from an Internet Gateway through the security group and route table.`,
          severity,
          remediation: { recommendation: { text: `Restrict the security group so that port ${port} is only reachable from the addresses that need it.` } },
          resources: [ec2Resource(a, region, i)],
          networkReachabilityDetails: { networkPath: { steps: [{ componentId: 'igw', componentType: 'AWS::EC2::InternetGateway' }, { componentId: i.SecurityGroupIds[0], componentType: 'AWS::EC2::SecurityGroup' }, { componentId: i.InstanceId, componentType: 'AWS::EC2::Instance' }] }, openPortRange: { begin: port, end: port }, protocol: 'TCP' },
          meta: { resourceType: 'AWS_EC2_INSTANCE', resourceId: i.InstanceId, port, key },
        });
      }
      // paquetes: solo si Systems Manager gestiona la instancia
      if (!ssmStatus(a, region, i, { settled: true }).online) continue;
      for (const p of unpatchedCves(a, region, i)) {
        const pkg = p.title.split(':')[0].replace(/\d.*$/, '') || p.title;
        for (const cve of p.cves) {
          const sev = SEV_OF_PATCH[p.severity] ?? 'MEDIUM';
          const key = `pkg|${i.InstanceId}|${cve}`;
          out.push({
            findingArn: mk(key),
            awsAccountId: a.id,
            type: 'PACKAGE_VULNERABILITY',
            title: `${cve} - ${pkg}`,
            description: `A flaw was found in ${pkg}. ${p.title}.`,
            severity: sev,
            inspectorScore: SEV_SCORE[sev],
            exploitAvailable: sev === 'CRITICAL' ? 'YES' : 'NO',
            fixAvailable: 'YES',
            remediation: { recommendation: { text: `Update the package: dnf update ${pkg} (or install ${p.id} with AWS-RunPatchBaseline).` } },
            resources: [ec2Resource(a, region, i)],
            packageVulnerabilityDetails: { vulnerabilityId: cve, source: 'NVD', vendorSeverity: p.severity, cvss: [{ baseScore: SEV_SCORE[sev], scoringVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', source: 'NVD', version: '3.1' }], vulnerablePackages: [{ name: pkg, version: '1.0.0', release: '1.amzn2023', arch: 'X86_64', packageManager: 'OS', fixedInVersion: '1.0.1', remediation: `dnf update ${pkg}` }], referenceUrls: [`https://nvd.nist.gov/vuln/detail/${cve}`] },
            meta: { resourceType: 'AWS_EC2_INSTANCE', resourceId: i.InstanceId, vulnerabilityId: cve, packageName: pkg, key },
          });
        }
      }
    }
  }
  if (st.enabled.ECR) {
    for (const repo of Object.values(ecrOf(a, region).repos)) {
      for (const im of repo.images) {
        for (const f of scanPackages(im.image.pkgs)) {
          const key = `ecr|${repo.name}|${im.digest}|${f.name}`;
          out.push({
            findingArn: mk(key),
            awsAccountId: a.id,
            type: 'PACKAGE_VULNERABILITY',
            title: `${f.name} - ${f.package}`,
            description: f.description,
            severity: f.severity,
            inspectorScore: SEV_SCORE[f.severity] ?? 0,
            exploitAvailable: 'NO',
            fixAvailable: f.fixedIn ? 'YES' : 'NO',
            remediation: { recommendation: { text: f.fixedIn ? `Upgrade ${f.package} to ${f.fixedIn} or later and rebuild the image.` : 'No fix is available yet.' } },
            resources: [{ id: `${repo.name}/${im.digest}`, type: 'AWS_ECR_CONTAINER_IMAGE', region, partition: 'aws', details: { awsEcrContainerImage: { repositoryName: repo.name, imageTags: im.tags, imageHash: im.digest, registry: a.id, pushedAt: iso(im.pushedAt) } } }],
            packageVulnerabilityDetails: { vulnerabilityId: f.name, source: 'NVD', vulnerablePackages: [{ name: f.package, version: f.version, packageManager: 'OS', ...(f.fixedIn ? { fixedInVersion: f.fixedIn } : {}) }], referenceUrls: [`https://nvd.nist.gov/vuln/detail/${f.name}`] },
            meta: { resourceType: 'AWS_ECR_CONTAINER_IMAGE', resourceId: `${repo.name}/${im.digest}`, vulnerabilityId: f.name, packageName: f.package, repository: repo.name, key },
          });
        }
      }
    }
  }
  return out;
}

// ───────────────────────── filtros ─────────────────────────

type StrFilter = { comparison: string; value: string };
type NumFilter = { lowerInclusive?: number; upperInclusive?: number };

function strOk(have: string | undefined, filters: StrFilter[] | undefined): boolean {
  if (!filters?.length) return true;
  return filters.some((f) => (f.comparison === 'EQUALS' ? have === f.value : f.comparison === 'PREFIX' ? !!have?.startsWith(f.value) : f.comparison === 'NOT_EQUALS' ? have !== f.value : false));
}

/** ¿Cumple el hallazgo los criterios (`severity`, `findingType`, `resourceId`, `vulnerabilityId`…)? */
export function inspMatches(f: InspFinding, c: Record<string, any> | undefined): boolean {
  if (!c) return true;
  const num = (have: number | undefined, n: NumFilter[] | undefined) => !n?.length || n.some((x) => have !== undefined && (x.lowerInclusive === undefined || have >= x.lowerInclusive) && (x.upperInclusive === undefined || have <= x.upperInclusive));
  return (
    strOk(f.severity, c.severity) &&
    strOk(f.type, c.findingType) &&
    strOk(f.status, c.findingStatus) &&
    strOk(f.meta.resourceType, c.resourceType) &&
    strOk(f.meta.resourceId, c.resourceId) &&
    strOk(f.meta.vulnerabilityId, c.vulnerabilityId) &&
    strOk(f.title, c.title) &&
    strOk(f.awsAccountId, c.awsAccountId) &&
    strOk(f.meta.repository, c.ecrImageRepositoryName) &&
    strOk(f.exploitAvailable, c.exploitAvailable) &&
    strOk(f.fixAvailable, c.fixAvailable) &&
    strOk(f.meta.packageName, c['vulnerablePackages.name'] ?? c.vulnerablePackagesName) &&
    num(f.inspectorScore, c.inspectorScore) &&
    num(f.meta.port, (c.portRange as { beginInclusive?: number }[] | undefined)?.map((p) => ({ lowerInclusive: p.beginInclusive, upperInclusive: p.beginInclusive })))
  );
}

// ───────────────────────── estado de los hallazgos ─────────────────────────

/** Calcula los hallazgos, los compara con lo que se vio antes y deja constancia de los nuevos y los cerrados. */
export function inspFindings(a: Account, region: string, o: { publish?: boolean } = {}): InspFinding[] {
  const st = inspOf(a, region);
  const live = compute(a, region, st);
  const liveKeys = new Set(live.map((f) => f.meta.key));
  const all: InspFinding[] = [];
  for (const f of live) {
    let seen = st.seen[f.meta.key];
    const isNew = !seen || !!seen.closed;
    if (!seen) seen = st.seen[f.meta.key] = { first: a.clock, last: a.clock };
    else if (seen.closed) {
      delete seen.closed;
      seen.first = a.clock;
    }
    seen.last = a.clock;
    const base: InspFinding = { ...f, status: 'ACTIVE', firstObservedAt: iso(seen.first), lastObservedAt: iso(a.clock), updatedAt: iso(a.clock) };
    const sup = Object.values(st.filters).find((x) => x.action === 'SUPPRESS' && inspMatches(base, x.criteria));
    if (sup) base.status = 'SUPPRESSED';
    seen.snap = base;
    all.push(base);
    if (isNew && o.publish && base.status === 'ACTIVE') {
      try {
        putEvent(a, region, 'default', { source: 'aws.inspector2', detailType: 'Inspector2 Finding', resources: [base.resources[0]?.id ?? ''], detail: { awsAccountId: a.id, description: base.description, findingArn: base.findingArn, firstObservedAt: base.firstObservedAt, lastObservedAt: base.lastObservedAt, packageVulnerabilityDetails: base.packageVulnerabilityDetails, remediation: base.remediation, resources: base.resources, severity: base.severity, status: base.status, title: base.title, type: base.type, inspectorScore: base.inspectorScore, exploitAvailable: base.exploitAvailable, fixAvailable: base.fixAvailable } });
      } catch {
        /* sin reglas */
      }
    }
  }
  // lo que se vio y ya no está (parcheado, puerto cerrado, imagen borrada) queda cerrado
  for (const [key, s] of Object.entries(st.seen)) {
    if (liveKeys.has(key)) continue;
    s.closed ??= a.clock;
    if (s.snap) all.push({ ...(s.snap as InspFinding), status: 'CLOSED', lastObservedAt: iso(s.last), updatedAt: iso(s.closed) });
  }
  return all;
}

tickers.push((a) => {
  for (const [region, rs] of Object.entries(a.regions)) {
    const st = rs.inspector2;
    if (!st || !(st.enabled.EC2 || st.enabled.ECR || st.enabled.LAMBDA)) continue;
    if (a.clock - st.lastScan < 60000) continue;
    st.lastScan = a.clock;
    inspFindings(a, region, { publish: true });
  }
});

// ───────────────────────── activación ─────────────────────────

const rtypes = (raw: unknown): RType[] => {
  const l = toArr<string>(raw as string[]).map((x) => String(x).toUpperCase());
  for (const x of l) if (!(TYPES as readonly string[]).includes(x)) throw val(`1 validation error detected: Value '[${x}]' at 'resourceTypes' failed to satisfy constraint: Member must satisfy enum value set: [EC2, ECR, LAMBDA, LAMBDA_CODE]`);
  return l as RType[];
};

const status = (a: Account, st: InspState) => {
  const on = TYPES.filter((t) => st.enabled[t]);
  const s = (t: RType) => ({ status: st.enabled[t] ? 'ENABLED' : 'DISABLED' });
  return { accountId: a.id, state: { status: on.length ? 'ENABLED' : 'DISABLED' }, resourceState: { ec2: s('EC2'), ecr: s('ECR'), lambda: s('LAMBDA') } };
};

op('inspector2', 'enable', 'resource-types:l! account-ids:l client-token:s', 'Activa Inspector para EC2, ECR y/o Lambda (empieza a escanear solo).', { res: () => '*' }, (c) => {
  const st = inspOf(c.acct, c.region);
  const t = rtypes(c.p.ResourceTypes);
  if (!TYPES.some((x) => st.enabled[x])) st.since = c.acct.clock;
  for (const x of t) st.enabled[x] = true;
  return { accounts: [status(c.acct, st)], failedAccounts: [] };
});

op('inspector2', 'disable', 'account-ids:l resource-types:l', 'Desactiva Inspector (sin tipos, lo desactiva todo).', { res: () => '*' }, (c) => {
  const st = inspOf(c.acct, c.region);
  const t = c.p.ResourceTypes ? rtypes(c.p.ResourceTypes) : [...TYPES];
  for (const x of t) st.enabled[x] = false;
  return { accounts: [status(c.acct, st)], failedAccounts: [] };
});

op('inspector2', 'batch-get-account-status', 'account-ids:l', 'Qué tipos de escaneo están activos en la cuenta.', { res: () => '*' }, (c) => ({ accounts: [status(c.acct, inspOf(c.acct, c.region))], failedAccounts: [] }));

// ───────────────────────── hallazgos y agregaciones ─────────────────────────

const view = (f: InspFinding) => {
  const { meta: _m, ...rest } = f;
  void _m;
  return rest;
};

const need = (c: OpCtx) => {
  const st = inspOf(c.acct, c.region);
  if (!TYPES.some((x) => st.enabled[x])) throw new AwsError('AccessDeniedException', 'Inspector is not enabled for this account. Enable it with `aws inspector2 enable`.', 403);
};

function listed(c: OpCtx): InspFinding[] {
  need(c);
  const crit = c.p.FilterCriteria as Record<string, any> | undefined;
  const sort = c.p.SortCriteria as { field?: string; sortOrder?: string } | undefined;
  let list = inspFindings(c.acct, c.region, {}).filter((f) => inspMatches(f, crit));
  const field = sort?.field ?? 'SEVERITY';
  const rank = (s: string) => ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL'].indexOf(s);
  list = list.sort((x, y) => (field === 'SEVERITY' ? rank(x.severity) - rank(y.severity) : field === 'INSPECTOR_SCORE' ? (y.inspectorScore ?? 0) - (x.inspectorScore ?? 0) : x.title.localeCompare(y.title)));
  if (sort?.sortOrder === 'ASC') list.reverse();
  return list;
}

op('inspector2', 'list-findings', 'filter-criteria:j sort-criteria:j max-results:i next-token:s', 'Los hallazgos de Inspector (vulnerabilidades de paquetes y alcanzabilidad de red).', { res: () => '*' }, (c) => ({ findings: listed(c).slice(0, Number(c.p.MaxResults ?? 100)).map(view) }));

const counts = (list: InspFinding[]) => ({ all: list.length, critical: list.filter((f) => f.severity === 'CRITICAL').length, high: list.filter((f) => f.severity === 'HIGH').length, medium: list.filter((f) => f.severity === 'MEDIUM').length });

op('inspector2', 'list-finding-aggregations', 'aggregation-type:s! account-ids:l aggregation-request:j max-results:i next-token:s', 'Agrupa los hallazgos por título (CVE), paquete, instancia, repositorio o cuenta.', { res: () => '*' }, (c) => {
  need(c);
  const type = String(c.p.AggregationType);
  const list = inspFindings(c.acct, c.region, {}).filter((f) => f.status === 'ACTIVE');
  const group = (keyOf: (f: InspFinding) => string | undefined) => {
    const m = new Map<string, InspFinding[]>();
    for (const f of list) {
      const k = keyOf(f);
      if (k) m.set(k, [...(m.get(k) ?? []), f]);
    }
    return [...m.entries()];
  };
  switch (type) {
    case 'TITLE':
      return { aggregationType: type, responses: group((f) => f.meta.vulnerabilityId).map(([vulnerabilityId, l]) => ({ titleAggregation: { vulnerabilityId, accountId: c.acct.id, severityCounts: counts(l) } })) };
    case 'PACKAGE':
      return { aggregationType: type, responses: group((f) => f.meta.packageName).map(([packageName, l]) => ({ packageAggregation: { packageName, accountId: c.acct.id, severityCounts: counts(l) } })) };
    case 'AWS_EC2_INSTANCE':
      return { aggregationType: type, responses: group((f) => (f.meta.resourceType === 'AWS_EC2_INSTANCE' ? f.meta.resourceId : undefined)).map(([instanceId, l]) => ({ ec2InstanceAggregation: { instanceId, accountId: c.acct.id, networkFindings: l.filter((f) => f.type === 'NETWORK_REACHABILITY').length, severityCounts: counts(l) } })) };
    case 'REPOSITORY':
      return { aggregationType: type, responses: group((f) => f.meta.repository).map(([repository, l]) => ({ repositoryAggregation: { repository, accountId: c.acct.id, affectedImages: new Set(l.map((f) => f.meta.resourceId)).size, severityCounts: counts(l) } })) };
    case 'ACCOUNT':
      return { aggregationType: type, responses: [{ accountAggregation: { accountId: c.acct.id, severityCounts: counts(list) } }] };
    default:
      throw val(`1 validation error detected: Value '${type}' at 'aggregationType' failed to satisfy constraint: Member must satisfy enum value set: [FINDING_TYPE, PACKAGE, TITLE, REPOSITORY, AMI, AWS_EC2_INSTANCE, AWS_ECR_CONTAINER, IMAGE_LAYER, ACCOUNT, AWS_LAMBDA_FUNCTION, LAMBDA_LAYER]`);
  }
});

op('inspector2', 'list-coverage', 'filter-criteria:j max-results:i next-token:s', 'Qué recursos escanea Inspector y, si no puede, por qué (por ejemplo, instancia sin agente de SSM).', { res: () => '*' }, (c) => {
  const st = inspOf(c.acct, c.region);
  const out: Record<string, any>[] = [];
  const r = regional(c.acct, c.region).ec2;
  if (st.enabled.EC2) {
    for (const i of Object.values(r.instances)) {
      if (i.state === 'terminated') continue;
      const ssm = ssmStatus(c.acct, c.region, i, { settled: true });
      out.push({ accountId: c.acct.id, resourceId: i.InstanceId, resourceType: 'AWS_EC2_INSTANCE', scanType: 'NETWORK', resourceMetadata: { ec2: { platform: 'LINUX', tags: tagsOf(i) } }, scanStatus: { statusCode: i.state === 'running' ? 'ACTIVE' : 'INACTIVE', reason: i.state === 'running' ? 'SUCCESSFUL' : 'EC2_INSTANCE_STOPPED' } });
      out.push({ accountId: c.acct.id, resourceId: i.InstanceId, resourceType: 'AWS_EC2_INSTANCE', scanType: 'PACKAGE', resourceMetadata: { ec2: { platform: 'LINUX', tags: tagsOf(i) } }, scanStatus: ssm.online ? { statusCode: 'ACTIVE', reason: 'SUCCESSFUL' } : { statusCode: 'INACTIVE', reason: i.state !== 'running' ? 'EC2_INSTANCE_STOPPED' : 'UNMANAGED_EC2_INSTANCE' } });
    }
  }
  if (st.enabled.ECR) for (const repo of Object.values(ecrOf(c.acct, c.region).repos)) out.push({ accountId: c.acct.id, resourceId: repo.name, resourceType: 'AWS_ECR_REPOSITORY', scanType: 'PACKAGE', resourceMetadata: { ecrRepository: { name: repo.name, scanFrequency: 'CONTINUOUS_SCAN' } }, scanStatus: { statusCode: 'ACTIVE', reason: 'SUCCESSFUL' } });
  const crit = c.p.FilterCriteria as Record<string, StrFilter[]> | undefined;
  return { coveredResources: out.filter((x) => strOk(x.resourceType, crit?.resourceType) && strOk(x.scanType, crit?.scanType) && strOk(x.scanStatus.statusCode, crit?.scanStatusCode) && strOk(x.scanStatus.reason, crit?.scanStatusReason) && strOk(x.resourceId, crit?.resourceId)) };
});

// ───────────────────────── filtros de supresión ─────────────────────────

const filterArn = (c: Pick<OpCtx, 'acct' | 'region'>, name: string) => mkArn('inspector2', c.region, c.acct.id, `owner/${c.acct.id}/filter/${stableId('inspf:' + name, '', 16, 'hex')}`);
const fView = (f: InspFilter, a: Account) => ({ arn: f.arn, ownerId: a.id, name: f.name, criteria: f.criteria, action: f.action, description: f.description, createdAt: iso(f.created), updatedAt: iso(f.created), tags: {} });

op('inspector2', 'create-filter', 'action:s! filter-criteria:j! name:s! description:s reason:s tags:t', 'Crea un filtro. Con la acción SUPPRESS oculta los hallazgos que coinciden (siguen existiendo, como SUPPRESSED).', { res: () => '*' }, (c) => {
  need(c);
  const st = inspOf(c.acct, c.region);
  const action = String(c.p.Action);
  if (!['NONE', 'SUPPRESS'].includes(action)) throw val(`1 validation error detected: Value '${action}' at 'action' failed to satisfy constraint: Member must satisfy enum value set: [NONE, SUPPRESS]`);
  if (Object.values(st.filters).some((f) => f.name === c.p.Name)) throw new AwsError('ConflictException', 'A filter with that name already exists.', 409);
  const arn = filterArn(c, String(c.p.Name));
  st.filters[arn] = { arn, name: String(c.p.Name), action: action as 'NONE' | 'SUPPRESS', description: c.p.Description ?? '', criteria: c.p.FilterCriteria as Record<string, any>, created: c.acct.clock };
  return { arn };
});
op('inspector2', 'list-filters', 'action:s arns:l max-results:i next-token:s', 'Lista los filtros.', { res: () => '*' }, (c) => ({ filters: Object.values(inspOf(c.acct, c.region).filters).filter((f) => !c.p.Action || f.action === c.p.Action).map((f) => fView(f, c.acct)) }));
op('inspector2', 'delete-filter', 'arn:s!', 'Borra un filtro (los hallazgos suprimidos vuelven a estar activos).', { res: () => '*' }, (c) => {
  const st = inspOf(c.acct, c.region);
  if (!st.filters[String(c.p.Arn)]) throw new AwsError('ResourceNotFoundException', 'The filter does not exist.', 404);
  delete st.filters[String(c.p.Arn)];
  return { arn: c.p.Arn };
});

