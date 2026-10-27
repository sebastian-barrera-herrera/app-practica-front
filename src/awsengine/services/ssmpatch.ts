/** Systems Manager Patch Manager: líneas base de parches, grupos de parches y `AWS-RunPatchBaseline` (Scan / Install). */
import { regional } from '../account';
import { IMAGES } from '../catalog';
import { AwsError, op } from '../registry';
import { START_CLOCK, iso, mkArn, newId, toArr } from '../util';
import type { Account, Ec2Instance } from '../types';
import type { SsmBaseline, SsmPatchState } from '../types-ops';
import { commandDocs, normTargets, ssmOf } from './ssm';
import { tagHooks } from './ssmparams';

// ───────────────────────── catálogo de parches ─────────────────────────

interface Patch {
  id: string;
  title: string;
  classification: 'Security' | 'Bugfix' | 'Enhancement';
  severity: 'Critical' | 'Important' | 'Medium' | 'Low';
  /** Días antes del comienzo del simulador en que se publicó. */
  daysBefore: number;
  cves: string[];
  reboot?: boolean;
}

const DAY = 86400000;
const PATCHES: Patch[] = [
  { id: 'ALAS2023-2026-0151', title: 'kernel6.1: security update', classification: 'Security', severity: 'Important', daysBefore: 45, cves: ['CVE-2026-1101', 'CVE-2026-1102'], reboot: true },
  { id: 'ALAS2023-2026-0160', title: 'openssl: security update', classification: 'Security', severity: 'Critical', daysBefore: 40, cves: ['CVE-2026-0910'] },
  { id: 'ALAS2023-2026-0172', title: 'curl: security update', classification: 'Security', severity: 'Medium', daysBefore: 30, cves: ['CVE-2026-1230'] },
  { id: 'ALAS2023-2026-0188', title: 'glibc: bugfix update', classification: 'Bugfix', severity: 'Low', daysBefore: 25, cves: [] },
  { id: 'ALAS2023-2026-0195', title: 'nginx: security update', classification: 'Security', severity: 'Important', daysBefore: 12, cves: ['CVE-2026-1344'] },
  { id: 'ALAS2023-2026-0203', title: 'python3.11: enhancement update', classification: 'Enhancement', severity: 'Low', daysBefore: 9, cves: [] },
  { id: 'ALAS2023-2026-0210', title: 'sudo: security update', classification: 'Security', severity: 'Critical', daysBefore: 4, cves: ['CVE-2026-1402'] },
  { id: 'ALAS2023-2026-0215', title: 'systemd: bugfix update', classification: 'Bugfix', severity: 'Medium', daysBefore: 2, cves: [] },
];

const released = (p: Patch) => START_CLOCK - p.daysBefore * DAY;

const OSES = ['WINDOWS', 'AMAZON_LINUX', 'AMAZON_LINUX_2', 'AMAZON_LINUX_2023', 'UBUNTU', 'REDHAT_ENTERPRISE_LINUX', 'SUSE', 'CENTOS', 'ORACLE_LINUX', 'DEBIAN', 'MACOS', 'RASPBIAN', 'ROCKY_LINUX', 'ALMA_LINUX'];

function osOf(inst: Ec2Instance): string {
  const img = IMAGES.find((i) => inst.ImageId.endsWith(i.key) || inst.ImageId === i.key);
  const key = img?.key ?? '';
  if (key.startsWith('al2023')) return 'AMAZON_LINUX_2023';
  if (key.startsWith('al2')) return 'AMAZON_LINUX_2';
  if (key.startsWith('ubuntu')) return 'UBUNTU';
  if (key.startsWith('debian')) return 'DEBIAN';
  if (key.startsWith('win')) return 'WINDOWS';
  return 'AMAZON_LINUX_2023';
}

// ───────────────────────── líneas base ─────────────────────────

const arn = (c: { acct: Account; region: string }, id: string) => mkArn('ssm', c.region, c.acct.id, `patchbaseline/${id}`);
const DEFAULT_RULES = { PatchRules: [{ PatchFilterGroup: { PatchFilters: [{ Key: 'CLASSIFICATION', Values: ['Security', 'Bugfix'] }, { Key: 'SEVERITY', Values: ['Critical', 'Important', 'Medium', 'Low'] }] }, ComplianceLevel: 'UNSPECIFIED', ApproveAfterDays: 7, EnableNonSecurity: false }] };

export function baselinesOf(a: Account, region: string): Record<string, SsmBaseline> {
  const st = ssmOf(a, region);
  if (!st.baselines) {
    st.baselines = {};
    for (const os of OSES) {
      const id = `pb-${os === 'AMAZON_LINUX_2023' ? '0e3a4d5c6b7a89012' : newId(a, 'pbdef' + os, '', 17, 'hex')}`;
      st.baselines[id] = { BaselineId: id, Name: `AWS-${os.split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join('')}DefaultPatchBaseline`, OperatingSystem: os, Description: `Default Patch Baseline for ${os} provided by AWS.`, ApprovalRules: JSON.parse(JSON.stringify(DEFAULT_RULES)), ApprovedPatches: [], RejectedPatches: [], DefaultBaseline: true, created: START_CLOCK - 200 * DAY, groups: [] };
    }
    st.defaultBaseline = Object.fromEntries(Object.values(st.baselines).map((b) => [b.OperatingSystem, b.BaselineId]));
  }
  return st.baselines;
}

const defaultFor = (a: Account, region: string, os: string): SsmBaseline => {
  const all = baselinesOf(a, region);
  return all[ssmOf(a, region).defaultBaseline?.[os] ?? ''] ?? Object.values(all).find((b) => b.OperatingSystem === os && b.DefaultBaseline)!;
};

const groupOf = (inst: Ec2Instance): string => inst.Tags.find((t) => t.Key === 'Patch Group' || t.Key === 'PatchGroup')?.Value ?? '';

export function baselineFor(a: Account, region: string, inst: Ec2Instance): SsmBaseline {
  const os = osOf(inst);
  const g = groupOf(inst);
  const all = Object.values(baselinesOf(a, region));
  if (g) {
    const b = all.find((x) => x.groups.includes(g) && x.OperatingSystem === os);
    if (b) return b;
  }
  return defaultFor(a, region, os);
}

function approvedPatch(a: Account, b: SsmBaseline, p: Patch): boolean {
  if (b.RejectedPatches.includes(p.id)) return false;
  if (b.ApprovedPatches.includes(p.id)) return true;
  return b.ApprovalRules.PatchRules.some((rule) => {
    for (const f of rule.PatchFilterGroup.PatchFilters) {
      if (f.Key === 'CLASSIFICATION' && !f.Values.includes(p.classification) && !f.Values.includes('*')) return false;
      if (f.Key === 'SEVERITY' && !f.Values.includes(p.severity) && !f.Values.includes('*')) return false;
      if (f.Key === 'PRODUCT' && !f.Values.includes('AmazonLinux2023') && !f.Values.includes('*')) return false;
    }
    if (p.classification !== 'Security' && !rule.EnableNonSecurity && b.OperatingSystem !== 'WINDOWS' && !rule.PatchFilterGroup.PatchFilters.some((f) => f.Key === 'CLASSIFICATION' && f.Values.includes(p.classification))) return false;
    return a.clock - released(p) >= (rule.ApproveAfterDays ?? 0) * DAY;
  });
}

const complianceOf = (b: SsmBaseline, p: Patch): string => b.ApprovalRules.PatchRules.find(() => true)?.ComplianceLevel ?? 'UNSPECIFIED';

const stateOf = (a: Account, region: string, inst: Ec2Instance): SsmPatchState | undefined => ssmOf(a, region).patchStates?.[inst.InstanceId];

/** Estado de cada parche del catálogo en una instancia. */
function patchRows(a: Account, region: string, inst: Ec2Instance) {
  const b = baselineFor(a, region, inst);
  const st = stateOf(a, region, inst);
  const applicable = osOf(inst) === 'AMAZON_LINUX_2023';
  return PATCHES.map((p) => {
    const installed = !!st?.installed.includes(p.id);
    const ok = approvedPatch(a, b, p);
    const state = !applicable ? 'NotApplicable' : installed ? (b.RejectedPatches.includes(p.id) ? 'InstalledRejected' : 'Installed') : ok ? 'Missing' : 'NotApplicable';
    return { p, state, ok };
  });
}

// ───────────────────────── AWS-RunPatchBaseline ─────────────────────────

commandDocs['AWS-RunPatchBaseline'] = (a, region, inst, params) => {
  const op_ = params.Operation?.[0];
  if (op_ !== 'Scan' && op_ !== 'Install') return { out: '', err: 'Parameter Operation is required: use Scan or Install.\n', code: 1 };
  const reboot = params.RebootOption?.[0] ?? 'RebootIfNeeded';
  const b = baselineFor(a, region, inst);
  const stAll = (ssmOf(a, region).patchStates ??= {});
  const prev = stAll[inst.InstanceId];
  const st: SsmPatchState = prev ?? { InstanceId: inst.InstanceId, PatchGroup: '', BaselineId: b.BaselineId, OperationType: 'Scan', OperationStartTime: a.clock, OperationEndTime: a.clock, InstalledCount: 0, MissingCount: 0, FailedCount: 0, InstalledOtherCount: 0, RebootOption: reboot, installed: [] };
  st.PatchGroup = groupOf(inst);
  st.BaselineId = b.BaselineId;
  st.OperationType = op_;
  st.OperationStartTime = a.clock;
  st.RebootOption = reboot;
  stAll[inst.InstanceId] = st;
  const lines = [`Executing AWS-RunPatchBaseline: Operation=${op_} RebootOption=${reboot}`, `Baseline: ${b.BaselineId} (${b.Name}, ${b.OperatingSystem})`, `Patch group: ${st.PatchGroup || '(none: default baseline)'}`];
  if (osOf(inst) !== 'AMAZON_LINUX_2023') {
    lines.push('No patches apply to this operating system in this simulator.');
    st.OperationEndTime = a.clock + 20000;
    return { out: lines.join('\n') + '\n', err: '', code: 0 };
  }
  const rows = patchRows(a, region, inst);
  const missing = rows.filter((r) => r.state === 'Missing');
  if (op_ === 'Install') {
    for (const r of missing) {
      st.installed.push(r.p.id);
      lines.push(`Installed ${r.p.id} (${r.p.classification}, ${r.p.severity}): ${r.p.title}`);
    }
    if (missing.some((r) => r.p.reboot)) lines.push(reboot === 'NoReboot' ? 'A reboot is required to finish the kernel update (RebootOption=NoReboot).' : 'Rebooting to finish the kernel update.');
  } else for (const r of missing) lines.push(`Missing ${r.p.id} (${r.p.classification}, ${r.p.severity}): ${r.p.title}`);
  const after = patchRows(a, region, inst);
  st.InstalledCount = after.filter((r) => r.state === 'Installed').length;
  st.MissingCount = after.filter((r) => r.state === 'Missing').length;
  st.FailedCount = 0;
  st.OperationEndTime = a.clock + 20000;
  lines.push(`Result: Installed=${st.InstalledCount} Missing=${st.MissingCount} Failed=0 NotApproved=${after.filter((r) => !r.ok && r.state === 'NotApplicable').length}`);
  return { out: lines.join('\n') + '\n', err: '', code: 0 };
};

// ───────────────────────── operaciones ─────────────────────────

const view = (c: { acct: Account; region: string }, b: SsmBaseline) => ({ BaselineId: b.BaselineId, BaselineName: b.Name, OperatingSystem: b.OperatingSystem, BaselineDescription: b.Description ?? '', DefaultBaseline: ssmOf(c.acct, c.region).defaultBaseline?.[b.OperatingSystem] === b.BaselineId });

tagHooks.PatchBaseline = () => ({});

function checkRules(rules: unknown): SsmBaseline['ApprovalRules'] {
  const r = rules as SsmBaseline['ApprovalRules'];
  if (!r || !Array.isArray(r.PatchRules) || !r.PatchRules.length) throw new AwsError('ValidationException', 'ApprovalRules must contain at least one PatchRule.', 400);
  for (const pr of r.PatchRules) {
    if (!pr.PatchFilterGroup?.PatchFilters?.length) throw new AwsError('ValidationException', 'Each PatchRule needs a PatchFilterGroup with at least one PatchFilter.', 400);
    for (const f of pr.PatchFilterGroup.PatchFilters) if (!f.Key || !f.Values?.length) throw new AwsError('ValidationException', 'Each PatchFilter needs a Key and Values.', 400);
    if (pr.ApproveAfterDays !== undefined && (pr.ApproveAfterDays < 0 || pr.ApproveAfterDays > 360)) throw new AwsError('ValidationException', 'ApproveAfterDays must be between 0 and 360.', 400);
    pr.ApproveAfterDays = pr.ApproveAfterDays === undefined ? undefined : Number(pr.ApproveAfterDays);
  }
  return r;
}

op('ssm', 'create-patch-baseline', 'operating-system:s name:s! global-filters:j approval-rules:j approved-patches:l approved-patches-compliance-level:s approved-patches-enable-non-security:b rejected-patches:l rejected-patches-action:s description:s tags:f', 'Crea una línea base de parches: qué parches se aprueban (por clasificación y gravedad) y tras cuántos días.', { action: 'ssm:CreatePatchBaseline', res: () => '*' }, (c) => {
  const os = (c.p.OperatingSystem as string | undefined) ?? 'WINDOWS';
  if (!OSES.includes(os)) throw new AwsError('ValidationException', `1 validation error detected: Value '${os}' at 'operatingSystem' failed to satisfy constraint: Member must satisfy enum value set: [${OSES.join(', ')}]`, 400);
  const all = baselinesOf(c.acct, c.region);
  if (Object.values(all).some((b) => b.Name === c.p.Name)) throw new AwsError('AlreadyExistsException', `A patch baseline named ${c.p.Name} already exists.`, 400);
  const rules = c.p.ApprovalRules ? checkRules(c.p.ApprovalRules) : { PatchRules: [] };
  const id = `pb-${newId(c.acct, 'pb', '', 17, 'hex')}`;
  all[id] = { BaselineId: id, Name: String(c.p.Name), OperatingSystem: os, Description: c.p.Description, ApprovalRules: rules, ApprovedPatches: toArr<string>(c.p.ApprovedPatches), RejectedPatches: toArr<string>(c.p.RejectedPatches), DefaultBaseline: false, created: c.acct.clock, groups: [] };
  return { BaselineId: id };
});

op('ssm', 'update-patch-baseline', 'baseline-id:s! name:s global-filters:j approval-rules:j approved-patches:l rejected-patches:l description:s', 'Cambia una línea base de parches.', { action: 'ssm:UpdatePatchBaseline', res: (c) => arn(c, String(c.p.BaselineId)) }, (c) => {
  const b = baselinesOf(c.acct, c.region)[c.p.BaselineId];
  if (!b) throw new AwsError('DoesNotExistException', `Patch baseline ${c.p.BaselineId} does not exist.`, 400);
  if (c.p.Name) b.Name = c.p.Name;
  if (c.p.ApprovalRules) b.ApprovalRules = checkRules(c.p.ApprovalRules);
  if (c.p.ApprovedPatches) b.ApprovedPatches = toArr(c.p.ApprovedPatches);
  if (c.p.RejectedPatches) b.RejectedPatches = toArr(c.p.RejectedPatches);
  if (c.p.Description !== undefined) b.Description = c.p.Description;
  return getView(b);
});

const getView = (b: SsmBaseline) => ({ BaselineId: b.BaselineId, Name: b.Name, OperatingSystem: b.OperatingSystem, GlobalFilters: { PatchFilters: [] }, ApprovalRules: b.ApprovalRules, ApprovedPatches: b.ApprovedPatches, ApprovedPatchesComplianceLevel: 'UNSPECIFIED', ApprovedPatchesEnableNonSecurity: false, RejectedPatches: b.RejectedPatches, RejectedPatchesAction: 'ALLOW_AS_DEPENDENCY', PatchGroups: b.groups, CreatedDate: iso(b.created), ModifiedDate: iso(b.created), Description: b.Description ?? '', Sources: [] });

op('ssm', 'get-patch-baseline', 'baseline-id:s!', 'Detalle de una línea base de parches (reglas de aprobación, grupos registrados…).', { action: 'ssm:GetPatchBaseline', res: (c) => arn(c, String(c.p.BaselineId)) }, (c) => {
  const b = baselinesOf(c.acct, c.region)[c.p.BaselineId];
  if (!b) throw new AwsError('DoesNotExistException', `Patch baseline ${c.p.BaselineId} does not exist.`, 400);
  return getView(b);
});

op('ssm', 'describe-patch-baselines', 'filters:f max-results:i', 'Lista las líneas base de parches (las de AWS y las tuyas).', { paginate: 'BaselineIdentities', action: 'ssm:DescribePatchBaselines', res: () => '*' }, (c) => {
  const fl = normTargets(c.p.Filters);
  const list = Object.values(baselinesOf(c.acct, c.region)).filter((b) =>
    fl.every((f) => (f.Key === 'OWNER' ? f.Values.some((v) => (v === 'Self' ? !b.DefaultBaseline : v === 'AWS' ? b.DefaultBaseline : true)) : f.Key === 'NAME_PREFIX' ? f.Values.some((v) => b.Name.startsWith(v)) : f.Key === 'OPERATING_SYSTEM' ? f.Values.includes(b.OperatingSystem) : true)),
  );
  return { BaselineIdentities: list.sort((x, y) => (x.Name < y.Name ? -1 : 1)).map((b) => view(c, b)) };
});

op('ssm', 'delete-patch-baseline', 'baseline-id:s!', 'Borra una línea base (no puede ser la predeterminada ni tener grupos registrados).', { action: 'ssm:DeletePatchBaseline', res: (c) => arn(c, String(c.p.BaselineId)) }, (c) => {
  const all = baselinesOf(c.acct, c.region);
  const b = all[c.p.BaselineId];
  if (!b) throw new AwsError('DoesNotExistException', `Patch baseline ${c.p.BaselineId} does not exist.`, 400);
  if (b.DefaultBaseline || ssmOf(c.acct, c.region).defaultBaseline?.[b.OperatingSystem] === b.BaselineId) throw new AwsError('ResourceInUseException', 'You cannot delete the default patch baseline: make another one the default first.', 400);
  if (b.groups.length) throw new AwsError('ResourceInUseException', `The patch baseline is registered with the patch groups ${b.groups.join(', ')}: deregister them first.`, 400);
  delete all[c.p.BaselineId];
  return { BaselineId: c.p.BaselineId };
});

op('ssm', 'register-patch-baseline-for-patch-group', 'baseline-id:s! patch-group:s!', 'Asocia una línea base a un grupo de parches (las instancias con la etiqueta `Patch Group` de ese valor).', { action: 'ssm:RegisterPatchBaselineForPatchGroup', res: (c) => arn(c, String(c.p.BaselineId)) }, (c) => {
  const all = baselinesOf(c.acct, c.region);
  const b = all[c.p.BaselineId];
  if (!b) throw new AwsError('DoesNotExistException', `Patch baseline ${c.p.BaselineId} does not exist.`, 400);
  const other = Object.values(all).find((x) => x.groups.includes(c.p.PatchGroup) && x.OperatingSystem === b.OperatingSystem && x.BaselineId !== b.BaselineId);
  if (other) throw new AwsError('AlreadyExistsException', `The patch group ${c.p.PatchGroup} is already registered with the baseline ${other.BaselineId} for the operating system ${b.OperatingSystem}: deregister it first.`, 400);
  if (!b.groups.includes(c.p.PatchGroup)) b.groups.push(c.p.PatchGroup);
  return { BaselineId: b.BaselineId, PatchGroup: c.p.PatchGroup };
});

op('ssm', 'deregister-patch-baseline-for-patch-group', 'baseline-id:s! patch-group:s!', 'Quita la asociación de una línea base con un grupo de parches.', { action: 'ssm:DeregisterPatchBaselineForPatchGroup', res: (c) => arn(c, String(c.p.BaselineId)) }, (c) => {
  const b = baselinesOf(c.acct, c.region)[c.p.BaselineId];
  if (!b || !b.groups.includes(c.p.PatchGroup)) throw new AwsError('DoesNotExistException', 'The baseline is not registered for that patch group.', 400);
  b.groups = b.groups.filter((g) => g !== c.p.PatchGroup);
  return { BaselineId: b.BaselineId, PatchGroup: c.p.PatchGroup };
});

op('ssm', 'get-patch-baseline-for-patch-group', 'patch-group:s! operating-system:s', 'Qué línea base se aplica a un grupo de parches.', { action: 'ssm:GetPatchBaselineForPatchGroup', res: () => '*' }, (c) => {
  const os = (c.p.OperatingSystem as string | undefined) ?? 'WINDOWS';
  const b = Object.values(baselinesOf(c.acct, c.region)).find((x) => x.groups.includes(c.p.PatchGroup) && x.OperatingSystem === os) ?? defaultFor(c.acct, c.region, os);
  return { BaselineId: b.BaselineId, PatchGroup: c.p.PatchGroup, OperatingSystem: os };
});

op('ssm', 'describe-patch-groups', 'filters:f max-results:i', 'Grupos de parches y su línea base.', { paginate: 'Mappings', action: 'ssm:DescribePatchGroups', res: () => '*' }, (c) => ({
  Mappings: Object.values(baselinesOf(c.acct, c.region)).flatMap((b) => b.groups.map((g) => ({ PatchGroup: g, BaselineIdentity: view(c, b) }))),
}));

op('ssm', 'register-default-patch-baseline', 'baseline-id:s!', 'Convierte una línea base en la predeterminada de su sistema operativo.', { action: 'ssm:RegisterDefaultPatchBaseline', res: (c) => arn(c, String(c.p.BaselineId)) }, (c) => {
  const b = baselinesOf(c.acct, c.region)[c.p.BaselineId];
  if (!b) throw new AwsError('DoesNotExistException', `Patch baseline ${c.p.BaselineId} does not exist.`, 400);
  (ssmOf(c.acct, c.region).defaultBaseline ??= {})[b.OperatingSystem] = b.BaselineId;
  return { BaselineId: b.BaselineId };
});

op('ssm', 'get-default-patch-baseline', 'operating-system:s', 'La línea base predeterminada de un sistema operativo.', { action: 'ssm:GetDefaultPatchBaseline', res: () => '*' }, (c) => {
  const os = (c.p.OperatingSystem as string | undefined) ?? 'WINDOWS';
  return { BaselineId: defaultFor(c.acct, c.region, os).BaselineId, OperatingSystem: os };
});

const stateView = (s: SsmPatchState) => ({
  InstanceId: s.InstanceId,
  PatchGroup: s.PatchGroup,
  BaselineId: s.BaselineId,
  OperationStartTime: iso(s.OperationStartTime),
  OperationEndTime: iso(s.OperationEndTime),
  Operation: s.OperationType,
  InstalledCount: s.InstalledCount,
  InstalledOtherCount: s.InstalledOtherCount,
  InstalledPendingRebootCount: 0,
  InstalledRejectedCount: 0,
  MissingCount: s.MissingCount,
  FailedCount: s.FailedCount,
  UnreportedNotApplicableCount: 0,
  NotApplicableCount: 0,
  RebootOption: s.RebootOption,
});

op('ssm', 'describe-instance-patch-states', 'instance-ids:l! max-results:i', 'Resultado de la última operación de parches en cada instancia: instalados, pendientes y fallidos.', { paginate: 'InstancePatchStates', action: 'ssm:DescribeInstancePatchStates', res: () => '*' }, (c) => ({
  InstancePatchStates: (c.p.InstanceIds as string[]).map((i) => ssmOf(c.acct, c.region).patchStates?.[i]).filter((s): s is SsmPatchState => !!s).map(stateView),
}));

op('ssm', 'describe-instance-patch-states-for-patch-group', 'patch-group:s! filters:f max-results:i', 'Lo mismo, para todas las instancias de un grupo de parches.', { paginate: 'InstancePatchStates', action: 'ssm:DescribeInstancePatchStatesForPatchGroup', res: () => '*' }, (c) => ({
  InstancePatchStates: Object.values(ssmOf(c.acct, c.region).patchStates ?? {}).filter((s) => s.PatchGroup === c.p.PatchGroup).map(stateView),
}));

op('ssm', 'describe-instance-patches', 'instance-id:s! filters:f max-results:i', 'Estado de cada parche en una instancia: Installed, Missing, NotApplicable…', { paginate: 'Patches', action: 'ssm:DescribeInstancePatches', res: () => '*' }, (c) => {
  const inst = regional(c.acct, c.region).ec2.instances[c.p.InstanceId];
  if (!inst) throw new AwsError('InvalidInstanceId', `Instances [[${c.p.InstanceId}]] not in a valid state for account ${c.acct.id}`, 400);
  const fl = normTargets(c.p.Filters);
  const rows = patchRows(c.acct, c.region, inst).filter((r) => fl.every((f) => (f.Key === 'PatchState' || f.Key === 'State' ? f.Values.includes(r.state) : f.Key === 'Classification' ? f.Values.includes(r.p.classification) : f.Key === 'Severity' ? f.Values.includes(r.p.severity) : true)));
  const st = stateOf(c.acct, c.region, inst);
  return {
    Patches: rows.map((r) => ({ Title: r.p.title, KBId: r.p.id, Classification: r.p.classification, Severity: r.p.severity, State: r.state, InstalledTime: iso(r.state === 'Installed' && st ? st.OperationEndTime : 0), CVEIds: r.p.cves.join(',') })),
  };
});

op('ssm', 'describe-available-patches', 'filters:f max-results:i', 'Parches disponibles en el catálogo del sistema operativo.', { paginate: 'Patches', action: 'ssm:DescribeAvailablePatches', res: () => '*' }, (c) => ({
  Patches: PATCHES.map((p) => ({ Id: p.id, ReleaseDate: iso(released(p)), Title: p.title, Description: p.title, ContentUrl: `https://alas.aws.amazon.com/AL2023/${p.id}.html`, Vendor: 'Amazon', ProductFamily: 'AmazonLinux2023', Product: 'AmazonLinux2023', Classification: p.classification, MsrcSeverity: p.severity, KbNumber: p.id, MsrcNumber: '', Language: 'All' })),
}));

op('ssm', 'describe-effective-patches-for-patch-baseline', 'baseline-id:s! max-results:i', 'Qué parches del catálogo aprueba una línea base ahora mismo.', { paginate: 'EffectivePatches', action: 'ssm:DescribeEffectivePatchesForPatchBaseline', res: (c) => arn(c, String(c.p.BaselineId)) }, (c) => {
  const b = baselinesOf(c.acct, c.region)[c.p.BaselineId];
  if (!b) throw new AwsError('DoesNotExistException', `Patch baseline ${c.p.BaselineId} does not exist.`, 400);
  return { EffectivePatches: PATCHES.filter((p) => approvedPatch(c.acct, b, p)).map((p) => ({ Patch: { Id: p.id, Title: p.title, Classification: p.classification, MsrcSeverity: p.severity, ReleaseDate: iso(released(p)) }, PatchStatus: { DeploymentStatus: 'APPROVED', ComplianceLevel: complianceOf(b, p), ApprovalDate: iso(released(p)) } })) };
});

