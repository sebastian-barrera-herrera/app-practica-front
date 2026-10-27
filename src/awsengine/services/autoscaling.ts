/** Amazon EC2 Auto Scaling y las plantillas de lanzamiento: grupos que mantienen y reparten instancias, y escalan según la carga. */
import { md5 } from '../../engine/commands/hash';
import { regional } from '../account';
import { findImage, instanceType } from '../catalog';
import { AwsError, op, type OpCtx } from '../registry';
import { tickers } from '../tick';
import type { Account, Asg, AsgActivity, AsgInstance, Ec2Instance, LaunchTemplate, ScalingPolicy, Tag } from '../types';
import { ec2Id, iso, isoZ, newId } from '../util';
import { deregister, elb, lbsUsing, rpsAt, targetHealth } from './elb';
import { ec2Launch, ec2Terminate, parseProfile, publicIpFor, refreshEc2 } from './ec2';
import { evalAlarm, metricSeries } from './metrics';

const MIN = 60000;
const E = {
  val: (m: string) => new AwsError('ValidationError', m, 400),
  lt: (m: string) => new AwsError('InvalidLaunchTemplateName.NotFoundException', m, 400),
};

const uuid = (a: Account, kind: string) => newId(a, kind, '', 32, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

// ───────────────────────── plantillas de lanzamiento ─────────────────────────

const lts = (a: Account, region: string) => (regional(a, region).launchTemplates ??= {});

function findLt(a: Account, region: string, ref: { id?: string; name?: string }): LaunchTemplate {
  const all = Object.values(lts(a, region));
  const lt = all.find((l) => (ref.id && l.LaunchTemplateId === ref.id) || (ref.name && l.LaunchTemplateName === ref.name));
  if (!lt) throw E.lt(ref.id ? `The specified launch template, with template ID ${ref.id}, does not exist.` : `The specified launch template, with template name ${ref.name}, does not exist.`);
  return lt;
}

const resolveVersion = (lt: LaunchTemplate, v: string | undefined) => {
  const n = !v || v === '$Default' ? lt.DefaultVersionNumber : v === '$Latest' ? lt.LatestVersionNumber : Number(v);
  const ver = lt.versions.find((x) => x.VersionNumber === n);
  if (!ver) throw E.lt(`Could not find launch template version ${v}`);
  return ver;
};

function checkTemplateData(a: Account, region: string, d: Record<string, any>) {
  if (d.ImageId && !findImage(region, d.ImageId)) throw new AwsError('InvalidAMIID.NotFound', `The image id '[${d.ImageId}]' does not exist`, 400);
  if (d.InstanceType && !instanceType(d.InstanceType)) throw new AwsError('InvalidParameterValue', `The instance type '${d.InstanceType}' does not exist`, 400);
  const r = regional(a, region).ec2;
  for (const g of d.SecurityGroupIds ?? []) if (!r.securityGroups[g]) throw new AwsError('InvalidGroup.NotFound', `The security group '${g}' does not exist`, 400);
  if (d.KeyName && !r.keyPairs[d.KeyName]) throw new AwsError('InvalidKeyPair.NotFound', `The key pair '${d.KeyName}' does not exist`, 400);
}

const ltView = (lt: LaunchTemplate, c: OpCtx) => ({ LaunchTemplateId: lt.LaunchTemplateId, LaunchTemplateName: lt.LaunchTemplateName, CreateTime: lt.CreateTime, CreatedBy: c.caller.arn, DefaultVersionNumber: lt.DefaultVersionNumber, LatestVersionNumber: lt.LatestVersionNumber, ...(lt.Tags.length ? { Tags: lt.Tags } : {}) });

op('ec2', 'create-launch-template', 'launch-template-name:s! version-description:s launch-template-data:j! tag-specifications:f dry-run:b', 'Crea una plantilla de lanzamiento: la «receta» de las instancias (AMI, tipo, grupos de seguridad, user data…).', { dryRun: true, res: (c) => `arn:aws:ec2:${c.region}:${c.acct.id}:launch-template/*` }, (c) => {
  const name = String(c.p.LaunchTemplateName);
  if (!/^[a-zA-Z0-9()./_-]{3,128}$/.test(name)) throw new AwsError('InvalidLaunchTemplateName.MalformedException', 'Launch template name must be between 3 and 128 characters, and may contain letters, numbers, and the following characters: - _ . / ( ).', 400);
  if (Object.values(lts(c.acct, c.region)).some((l) => l.LaunchTemplateName === name)) throw new AwsError('InvalidLaunchTemplateName.AlreadyExistsException', `Launch template name already in use.`, 400);
  const data = (c.p.LaunchTemplateData ?? {}) as Record<string, any>;
  checkTemplateData(c.acct, c.region, data);
  const id = ec2Id(c.acct, 'lt');
  const now = iso(c.acct.clock);
  const lt: LaunchTemplate = { LaunchTemplateId: id, LaunchTemplateName: name, CreateTime: now, DefaultVersionNumber: 1, LatestVersionNumber: 1, versions: [{ VersionNumber: 1, VersionDescription: c.p.VersionDescription, LaunchTemplateData: data, CreateTime: now }], Tags: (c.p.TagSpecifications ?? []).filter((t: any) => t.ResourceType === 'launch-template').flatMap((t: any) => t.Tags) };
  lts(c.acct, c.region)[id] = lt;
  return { LaunchTemplate: ltView(lt, c) };
});

op('ec2', 'describe-launch-templates', 'launch-template-ids:l launch-template-names:l filters:f dry-run:b', 'Lista las plantillas de lanzamiento.', { dryRun: true, paginate: 'LaunchTemplates', res: () => '*' }, (c) => {
  let list = Object.values(lts(c.acct, c.region));
  if (c.p.LaunchTemplateIds) list = (c.p.LaunchTemplateIds as string[]).map((id) => findLt(c.acct, c.region, { id }));
  if (c.p.LaunchTemplateNames) list = (c.p.LaunchTemplateNames as string[]).map((name) => findLt(c.acct, c.region, { name }));
  return { LaunchTemplates: list.map((l) => ltView(l, c)) };
});

op('ec2', 'describe-launch-template-versions', 'launch-template-id:s launch-template-name:s versions:l dry-run:b', 'Versiones de una plantilla y los datos de cada una.', { dryRun: true, paginate: 'LaunchTemplateVersions', res: () => '*' }, (c) => {
  const lt = findLt(c.acct, c.region, { id: c.p.LaunchTemplateId, name: c.p.LaunchTemplateName });
  let vers = lt.versions;
  if (c.p.Versions) vers = (c.p.Versions as string[]).map((v) => resolveVersion(lt, v));
  return { LaunchTemplateVersions: vers.map((v) => ({ LaunchTemplateId: lt.LaunchTemplateId, LaunchTemplateName: lt.LaunchTemplateName, VersionNumber: v.VersionNumber, ...(v.VersionDescription ? { VersionDescription: v.VersionDescription } : {}), CreateTime: v.CreateTime, CreatedBy: c.caller.arn, DefaultVersion: v.VersionNumber === lt.DefaultVersionNumber, LaunchTemplateData: v.LaunchTemplateData })) };
});

op('ec2', 'create-launch-template-version', 'launch-template-id:s launch-template-name:s source-version:s version-description:s launch-template-data:j! dry-run:b', 'Crea una versión nueva de una plantilla (las existentes no se modifican nunca).', { dryRun: true, res: () => '*' }, (c) => {
  const lt = findLt(c.acct, c.region, { id: c.p.LaunchTemplateId, name: c.p.LaunchTemplateName });
  const base = c.p.SourceVersion ? resolveVersion(lt, c.p.SourceVersion).LaunchTemplateData : {};
  const data = { ...base, ...(c.p.LaunchTemplateData as Record<string, any>) };
  checkTemplateData(c.acct, c.region, data);
  if (lt.versions.length >= 10000) throw new AwsError('LaunchTemplateVersionLimitExceeded', 'Version limit exceeded', 400);
  lt.LatestVersionNumber++;
  const v = { VersionNumber: lt.LatestVersionNumber, VersionDescription: c.p.VersionDescription, LaunchTemplateData: data, CreateTime: iso(c.acct.clock) };
  lt.versions.push(v);
  return { LaunchTemplateVersion: { LaunchTemplateId: lt.LaunchTemplateId, LaunchTemplateName: lt.LaunchTemplateName, VersionNumber: v.VersionNumber, ...(v.VersionDescription ? { VersionDescription: v.VersionDescription } : {}), CreateTime: v.CreateTime, CreatedBy: c.caller.arn, DefaultVersion: false, LaunchTemplateData: data } };
});

op('ec2', 'modify-launch-template', 'launch-template-id:s launch-template-name:s default-version:s dry-run:b', 'Cambia la versión por defecto de una plantilla.', { dryRun: true, res: () => '*' }, (c) => {
  const lt = findLt(c.acct, c.region, { id: c.p.LaunchTemplateId, name: c.p.LaunchTemplateName });
  if (c.p.DefaultVersion) lt.DefaultVersionNumber = resolveVersion(lt, c.p.DefaultVersion).VersionNumber;
  return { LaunchTemplate: ltView(lt, c) };
});

op('ec2', 'delete-launch-template', 'launch-template-id:s launch-template-name:s dry-run:b', 'Borra una plantilla de lanzamiento.', { dryRun: true, res: () => '*' }, (c) => {
  const lt = findLt(c.acct, c.region, { id: c.p.LaunchTemplateId, name: c.p.LaunchTemplateName });
  delete lts(c.acct, c.region)[lt.LaunchTemplateId];
  return { LaunchTemplate: ltView(lt, c) };
});

const fromB64 = (s: string): string => {
  try {
    return decodeURIComponent(escape(atob(s)));
  } catch {
    return s;
  }
};

/** Lanza una instancia siguiendo una plantilla (queda `pending`, como con `run-instances`). */
export function launchFromTemplate(a: Account, region: string, lt: LaunchTemplate, version: string | undefined, subnetId: string, extraTags: Tag[] = []): Ec2Instance {
  const d = resolveVersion(lt, version).LaunchTemplateData;
  const r = regional(a, region).ec2;
  const profile = parseProfile(d.IamInstanceProfile);
  const tags: Tag[] = [...(d.TagSpecifications ?? []).filter((t: any) => t.ResourceType === 'instance').flatMap((t: any) => t.Tags), ...extraTags, { Key: 'aws:ec2launchtemplate:id', Value: lt.LaunchTemplateId }, { Key: 'aws:ec2launchtemplate:version', Value: String(resolveVersion(lt, version).VersionNumber) }];
  const inst = ec2Launch(a, region, { imageId: d.ImageId, type: d.InstanceType, key: d.KeyName, sgIds: d.SecurityGroupIds, subnetId, tags, userData: d.UserData ? fromB64(d.UserData) : undefined, profile });
  inst.state = 'pending';
  inst.stateAt = a.clock;
  inst.Monitoring = d.Monitoring?.Enabled ? 'enabled' : 'disabled';
  const nic = (d.NetworkInterfaces ?? [])[0];
  if (nic?.AssociatePublicIpAddress === false) inst.PublicIpAddress = undefined;
  else if (nic?.AssociatePublicIpAddress === true && !inst.PublicIpAddress) inst.PublicIpAddress = publicIpFor(inst.InstanceId + a.clock);
  void r;
  return inst;
}

// ───────────────────────── grupos ─────────────────────────

const asgs = (a: Account, region: string) => (regional(a, region).asg ??= { groups: {} }).groups;
const capacityRps = (type: string) => (instanceType(type)?.vcpu ?? 2) * 60;

function findAsg(a: Account, region: string, name: string): Asg {
  const g = asgs(a, region)[name];
  if (!g) throw E.val(`AutoScalingGroup name not found - null`);
  return g;
}

const policyArn = (a: Account, region: string, g: string, p: string) => `arn:aws:autoscaling:${region}:${a.id}:scalingPolicy:${uuid(a, 'pol:' + g + p)}:autoScalingGroupName/${g}:policyName/${p}`;

const activity = (a: Account, g: Asg, t: number, description: string, cause: string, status: AsgActivity['StatusCode'] = 'Successful'): void => {
  g.activities.unshift({ ActivityId: uuid(a, 'act'), Description: description, Cause: cause, StartTime: iso(t), EndTime: iso(t + 30000), StatusCode: status, Progress: 100 });
  if (g.activities.length > 100) g.activities.length = 100;
};

const inGroup = (g: Asg) => g.instances.filter((i) => i.LifecycleState === 'Pending' || i.LifecycleState === 'InService');

function pickSubnet(g: Asg, r: ReturnType<typeof regional>['ec2']): string {
  const counts: Record<string, number> = {};
  for (const i of inGroup(g)) counts[i.AvailabilityZone] = (counts[i.AvailabilityZone] ?? 0) + 1;
  let best = g.subnetIds[0];
  let bestN = Infinity;
  for (const id of g.subnetIds) {
    const az = r.subnets[id]?.AvailabilityZone;
    const n = counts[az] ?? 0;
    if (n < bestN) {
      best = id;
      bestN = n;
    }
  }
  return best;
}

function launchOne(a: Account, region: string, g: Asg, t: number, cause: string): void {
  const r = regional(a, region).ec2;
  const lt = lts(a, region)[g.LaunchTemplate.LaunchTemplateId];
  if (!lt) {
    activity(a, g, t, 'Launching a new EC2 instance', `${cause} The launch template no longer exists.`, 'Failed');
    return;
  }
  const subnet = pickSubnet(g, r);
  const extra: Tag[] = [{ Key: 'aws:autoscaling:groupName', Value: g.AutoScalingGroupName }, ...(g.Tags as (Tag & { PropagateAtLaunch?: boolean })[]).filter((x) => x.PropagateAtLaunch)];
  let inst: Ec2Instance;
  try {
    inst = launchFromTemplate(a, region, lt, g.LaunchTemplate.Version, subnet, extra.map((x) => ({ Key: x.Key, Value: x.Value })));
  } catch (e) {
    if (e instanceof AwsError) {
      activity(a, g, t, 'Launching a new EC2 instance', `${cause} ${e.message}`, 'Failed');
      return;
    }
    throw e;
  }
  inst.LaunchTime = iso(t);
  g.instances.push({ InstanceId: inst.InstanceId, AvailabilityZone: inst.AvailabilityZone, LifecycleState: 'Pending', HealthStatus: 'Healthy', since: t, ProtectedFromScaleIn: false });
  activity(a, g, t, `Launching a new EC2 instance: ${inst.InstanceId}`, cause);
}

function terminateOne(a: Account, region: string, g: Asg, inst: AsgInstance, t: number, cause: string): void {
  const r = regional(a, region).ec2;
  inst.LifecycleState = 'Terminating';
  for (const tgArn of g.TargetGroupARNs) {
    const tg = elb(a, region).tgs[tgArn];
    if (tg) deregister(a, tg, inst.InstanceId);
  }
  const e = r.instances[inst.InstanceId];
  if (e) {
    e.stateAt = e.state === 'running' || e.state === 'pending' ? t : e.stateAt;
    ec2Terminate(a, r, e);
  }
  activity(a, g, t, `Terminating EC2 instance: ${inst.InstanceId}`, cause);
}

/** Qué instancia retirar: de la zona con más instancias, la más antigua. */
function victim(g: Asg): AsgInstance | undefined {
  const live = inGroup(g).filter((i) => !i.ProtectedFromScaleIn);
  const counts: Record<string, number> = {};
  for (const i of inGroup(g)) counts[i.AvailabilityZone] = (counts[i.AvailabilityZone] ?? 0) + 1;
  const max = Math.max(0, ...live.map((i) => counts[i.AvailabilityZone]));
  return live.filter((i) => counts[i.AvailabilityZone] === max).sort((x, y) => x.since - y.since)[0];
}

const susp = (g: Asg, p: string) => g.SuspendedProcesses.includes(p);

/** Mantiene el número de instancias en el deseado. */
function maintain(a: Account, region: string, g: Asg, t: number, why: string): void {
  const have = inGroup(g).length;
  if (have < g.DesiredCapacity && !susp(g, 'Launch')) {
    for (let k = have; k < g.DesiredCapacity; k++) launchOne(a, region, g, t, `At ${isoZ(t)} an instance was started in response to a difference between desired and actual capacity, increasing the capacity from ${k} to ${k + 1}.${why}`);
  } else if (have > g.DesiredCapacity && !susp(g, 'Terminate')) {
    for (let k = have; k > g.DesiredCapacity; k--) {
      const v = victim(g);
      if (!v) break;
      terminateOne(a, region, g, v, t, `At ${isoZ(t)} an instance was taken out of service in response to a difference between desired and actual capacity, shrinking the capacity from ${k} to ${k - 1}.${why}`);
    }
  }
}

function setDesired(a: Account, g: Asg, n: number, t: number, cause: string): void {
  const next = Math.max(g.MinSize, Math.min(g.MaxSize, n));
  if (next === g.DesiredCapacity) return;
  g.lastScale = t;
  void cause;
  g.DesiredCapacity = next;
}

export function cronMatches(expr: string, t: number): boolean {
  const f = expr.trim().split(/\s+/);
  if (f.length < 5) return false;
  const d = new Date(t);
  const vals = [d.getUTCMinutes(), d.getUTCHours(), d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCDay()];
  return f.slice(0, 5).every((field, i) =>
    field.split(',').some((part) => {
      if (part === '*') return true;
      const m = /^(\d+)(?:-(\d+))?$/.exec(part);
      if (!m) return false;
      return m[2] ? vals[i] >= Number(m[1]) && vals[i] <= Number(m[2]) : vals[i] === Number(m[1]) || (i === 4 && Number(m[1]) === 7 && vals[i] === 0);
    }),
  );
}

// ───────────────────────── simulación minuto a minuto ─────────────────────────

function step(a: Account, region: string, g: Asg, t: number): void {
  const r = regional(a, region).ec2;
  // 1. estado de las instancias
  for (const ai of [...g.instances]) {
    const e = r.instances[ai.InstanceId];
    const gone = !e || e.state === 'terminated';
    if (ai.LifecycleState === 'Terminating') {
      if (gone) g.instances = g.instances.filter((x) => x !== ai);
      continue;
    }
    if (gone || e.state === 'stopped' || e.state === 'stopping' || e.state === 'shutting-down') {
      if (!susp(g, 'HealthCheck')) {
        for (const tgArn of g.TargetGroupARNs) {
          const tg = elb(a, region).tgs[tgArn];
          if (tg) deregister(a, tg, ai.InstanceId);
        }
        g.instances = g.instances.filter((x) => x !== ai);
        activity(a, g, t, `Terminating EC2 instance: ${ai.InstanceId}`, `At ${isoZ(t)} an instance was taken out of service in response to an EC2 health check indicating it has been terminated or failed.`);
      }
      continue;
    }
    if (ai.LifecycleState === 'Pending' && e.state === 'running') {
      ai.LifecycleState = 'InService';
      ai.since = t;
      for (const tgArn of g.TargetGroupARNs) {
        const tg = elb(a, region).tgs[tgArn];
        if (tg && !tg.targets.some((x) => x.Id === ai.InstanceId)) tg.targets.push({ Id: ai.InstanceId, Port: tg.Port, registeredAt: t });
      }
    }
  }
  // 2. comprobaciones de salud de ELB
  if (g.HealthCheckType === 'ELB' && !susp(g, 'HealthCheck')) {
    for (const ai of g.instances) {
      if (ai.LifecycleState !== 'InService' || t - ai.since < g.HealthCheckGracePeriod * 1000) continue;
      const bad = g.TargetGroupARNs.some((arn) => {
        const tg = elb(a, region).tgs[arn];
        const tt = tg?.targets.find((x) => x.Id === ai.InstanceId);
        return !!tg && !!tt && targetHealth(a, region, tg, tt).state === 'unhealthy';
      });
      if (bad) ai.HealthStatus = 'Unhealthy';
    }
  }
  if (!susp(g, 'ReplaceUnhealthy')) {
    for (const ai of g.instances.filter((x) => x.HealthStatus === 'Unhealthy' && x.LifecycleState !== 'Terminating')) terminateOne(a, region, g, ai, t, `At ${isoZ(t)} an instance was taken out of service in response to an ELB system health check failure.`);
  }
  // 3. carga y métricas del minuto
  const lbArns = new Set<string>();
  for (const arn of g.TargetGroupARNs) for (const lb of lbsUsing(a, region, arn)) lbArns.add(lb.LoadBalancerArn);
  const rps = [...lbArns].reduce((n, x) => n + rpsAt(a, x, t), 0);
  const serving = g.instances.filter((i) => i.LifecycleState === 'InService');
  const per = serving.length ? rps / serving.length : 0;
  const cap = serving.length ? serving.reduce((n, i) => n + capacityRps(r.instances[i.InstanceId]?.InstanceType ?? 't3.micro'), 0) / serving.length : capacityRps('t3.micro');
  const cpu = serving.length ? Math.min(100, Math.round((2 + (per / cap) * 100) * 10) / 10) : 0;
  g.history.push({ t, cpu, n: serving.length, rps });
  if (g.history.length > 240) g.history.shift();
  // 4. acciones programadas
  for (const s of g.scheduled ?? []) {
    const due = s.StartTime && !s.Recurrence ? Date.parse(s.StartTime) <= t && !s.lastRun : s.Recurrence ? cronMatches(s.Recurrence, t) && s.lastRun !== t && (!s.StartTime || Date.parse(s.StartTime) <= t) : false;
    if (!due || susp(g, 'ScheduledActions')) continue;
    s.lastRun = t;
    if (s.MinSize !== undefined) g.MinSize = s.MinSize;
    if (s.MaxSize !== undefined) g.MaxSize = s.MaxSize;
    if (s.DesiredCapacity !== undefined) g.DesiredCapacity = s.DesiredCapacity;
    g.DesiredCapacity = Math.max(g.MinSize, Math.min(g.MaxSize, g.DesiredCapacity));
    activity(a, g, t, `Scheduled action ${s.ScheduledActionName}`, `At ${isoZ(t)} a scheduled action update of AutoScalingGroup constraints to min: ${g.MinSize}, max: ${g.MaxSize}, desired: ${g.DesiredCapacity}.`);
  }
  // 5. políticas
  if (!susp(g, 'AlarmNotification')) {
    const before = g.DesiredCapacity;
    for (const p of Object.values(g.policies)) {
      if (!p.Enabled) continue;
      if (p.PolicyType === 'TargetTrackingScaling' && p.TargetTrackingConfiguration) {
        const cfg = p.TargetTrackingConfiguration;
        const kind = cfg.PredefinedMetricSpecification?.PredefinedMetricType;
        const metric = kind === 'ALBRequestCountPerTarget' ? per * 60 : cpu;
        const T = cfg.TargetValue;
        const warm = (p.EstimatedInstanceWarmup ?? g.DefaultInstanceWarmup) * 1000;
        const launching = g.instances.some((i) => i.LifecycleState === 'Pending') || serving.some((i) => t - i.since < warm);
        if (serving.length && metric > T) {
          g.lowMinutes = 0;
          const want = Math.ceil((serving.length * metric) / T);
          if (want > g.DesiredCapacity && !launching) setDesired(a, g, want, t, 'out');
        } else if (metric < T * 0.9 && !cfg.DisableScaleIn) {
          g.lowMinutes++;
          if (g.lowMinutes >= 15 && serving.length) {
            const want = Math.max(1, Math.ceil((serving.length * metric) / T));
            if (want < g.DesiredCapacity) setDesired(a, g, want, t, 'in');
            g.lowMinutes = 0;
          }
        } else g.lowMinutes = 0;
      } else if (p.PolicyType === 'SimpleScaling' || p.PolicyType === 'StepScaling') {
        const cool = (p.Cooldown ?? g.DefaultCooldown) * 1000;
        if (p.PolicyType === 'SimpleScaling' && t - g.lastScale < cool) continue;
        for (const al of Object.values(regional(a, region).alarms)) {
          if (!al.AlarmActions.includes(p.PolicyARN)) continue;
          const pts = metricSeries(a, region, { ns: al.Namespace, metric: al.MetricName, dims: Object.fromEntries((al.Dimensions as { Name: string; Value: string }[]).map((d) => [d.Name, d.Value])) });
          if (!pts || evalAlarm(al, pts, t) !== 'ALARM') continue;
          let adj = p.ScalingAdjustment ?? 0;
          if (p.PolicyType === 'StepScaling') {
            const val = pts.length ? pts[pts.length - 1].v : al.Threshold;
            const breach = val - al.Threshold;
            const stepAdj = (p.StepAdjustments ?? []).find((s) => (s.MetricIntervalLowerBound === undefined || breach >= s.MetricIntervalLowerBound) && (s.MetricIntervalUpperBound === undefined || breach < s.MetricIntervalUpperBound));
            if (!stepAdj) continue;
            adj = stepAdj.ScalingAdjustment;
          }
          const cur = g.DesiredCapacity;
          const next = p.AdjustmentType === 'PercentChangeInCapacity' ? cur + (adj >= 0 ? Math.max(1, Math.ceil((cur * adj) / 100)) : -Math.max(1, Math.ceil((cur * -adj) / 100))) : p.AdjustmentType === 'ExactCapacity' ? adj : cur + adj;
          setDesired(a, g, next, t, 'alarm');
          break;
        }
      }
    }
    if (g.DesiredCapacity !== before) maintain(a, region, g, t, ` A policy changed the desired capacity from ${before} to ${g.DesiredCapacity}.`);
  }
  // 6. mantener el número deseado y repartir entre zonas
  maintain(a, region, g, t, '');
  if (!susp(g, 'AZRebalance') && !susp(g, 'Terminate') && !susp(g, 'Launch') && g.subnetIds.length > 1) {
    const counts: Record<string, number> = {};
    for (const id of g.subnetIds) counts[r.subnets[id]?.AvailabilityZone] = 0;
    for (const i of inGroup(g)) counts[i.AvailabilityZone] = (counts[i.AvailabilityZone] ?? 0) + 1;
    const vals = Object.values(counts);
    if (inGroup(g).every((i) => i.LifecycleState === 'InService') && Math.max(...vals) - Math.min(...vals) >= 2) {
      const v = victim(g);
      if (v) terminateOne(a, region, g, v, t, `At ${isoZ(t)} an instance was taken out of service in response to an EC2 AZ rebalancing.`);
    }
  }
}

tickers.push((a) => {
  for (const region of Object.keys(a.regions)) {
    const groups = a.regions[region].asg?.groups;
    if (!groups || !Object.keys(groups).length) continue;
    refreshEc2(a, region);
    for (const g of Object.values(groups)) {
      let t = Math.max(g.lastEval, a.clock - 720 * MIN);
      for (;;) {
        const next = (Math.floor(t / MIN) + 1) * MIN;
        if (next > a.clock) break;
        t = next;
        // el reloj de EC2 también avanza con cada paso, para que las instancias pasen de `pending` a `running`
        const saved = a.clock;
        a.clock = t;
        refreshEc2(a, region);
        step(a, region, g, t);
        a.clock = saved;
      }
      g.lastEval = Math.max(g.lastEval, t);
    }
    refreshEc2(a, region);
  }
});

// ───────────────────────── vistas ─────────────────────────

const ltRef = (g: Asg) => ({ LaunchTemplateId: g.LaunchTemplate.LaunchTemplateId, LaunchTemplateName: g.LaunchTemplate.LaunchTemplateName, Version: g.LaunchTemplate.Version });

const instView = (a: Account, region: string, g: Asg, i: AsgInstance, withGroup = false) => ({
  InstanceId: i.InstanceId,
  InstanceType: regional(a, region).ec2.instances[i.InstanceId]?.InstanceType ?? 't3.micro',
  ...(withGroup ? { AutoScalingGroupName: g.AutoScalingGroupName } : {}),
  AvailabilityZone: i.AvailabilityZone,
  LifecycleState: i.LifecycleState,
  HealthStatus: i.HealthStatus,
  LaunchTemplate: ltRef(g),
  ProtectedFromScaleIn: i.ProtectedFromScaleIn,
});

const asgView = (a: Account, region: string, g: Asg) => ({
  AutoScalingGroupName: g.AutoScalingGroupName,
  AutoScalingGroupARN: g.AutoScalingGroupARN,
  LaunchTemplate: ltRef(g),
  MinSize: g.MinSize,
  MaxSize: g.MaxSize,
  DesiredCapacity: g.DesiredCapacity,
  DefaultCooldown: g.DefaultCooldown,
  AvailabilityZones: g.AvailabilityZones,
  LoadBalancerNames: [] as string[],
  TargetGroupARNs: g.TargetGroupARNs,
  HealthCheckType: g.HealthCheckType,
  HealthCheckGracePeriod: g.HealthCheckGracePeriod,
  Instances: g.instances.map((i) => instView(a, region, g, i)),
  CreatedTime: g.CreatedTime,
  SuspendedProcesses: g.SuspendedProcesses.map((ProcessName) => ({ ProcessName, SuspensionReason: 'User suspended at ' + iso(g.lastScale || a.clock) })),
  VPCZoneIdentifier: g.subnetIds.join(','),
  EnabledMetrics: [] as unknown[],
  Tags: (g.Tags as (Tag & { PropagateAtLaunch?: boolean })[]).map((t) => ({ ResourceId: g.AutoScalingGroupName, ResourceType: 'auto-scaling-group', Key: t.Key, Value: t.Value, PropagateAtLaunch: !!t.PropagateAtLaunch })),
  TerminationPolicies: ['Default'],
  NewInstancesProtectedFromScaleIn: false,
  ServiceLinkedRoleARN: `arn:aws:iam::${a.id}:role/aws-service-role/autoscaling.amazonaws.com/AWSServiceRoleForAutoScaling`,
  DefaultInstanceWarmup: g.DefaultInstanceWarmup,
});

const policyView = (g: Asg, p: ScalingPolicy) => ({
  AutoScalingGroupName: g.AutoScalingGroupName,
  PolicyName: p.PolicyName,
  PolicyARN: p.PolicyARN,
  PolicyType: p.PolicyType,
  ...(p.AdjustmentType ? { AdjustmentType: p.AdjustmentType } : {}),
  ...(p.ScalingAdjustment !== undefined ? { ScalingAdjustment: p.ScalingAdjustment } : {}),
  ...(p.Cooldown !== undefined ? { Cooldown: p.Cooldown } : {}),
  ...(p.StepAdjustments ? { StepAdjustments: p.StepAdjustments } : {}),
  ...(p.MetricAggregationType ? { MetricAggregationType: p.MetricAggregationType } : {}),
  ...(p.EstimatedInstanceWarmup !== undefined ? { EstimatedInstanceWarmup: p.EstimatedInstanceWarmup } : {}),
  ...(p.TargetTrackingConfiguration ? { TargetTrackingConfiguration: p.TargetTrackingConfiguration } : {}),
  Alarms: p.PolicyType === 'TargetTrackingScaling' ? [{ AlarmName: `TargetTracking-${g.AutoScalingGroupName}-AlarmHigh-${md5(p.PolicyARN).slice(0, 8)}-${md5(p.PolicyARN).slice(8, 12)}`, AlarmARN: '' }] : [],
  Enabled: p.Enabled,
});

// ───────────────────────── operaciones ─────────────────────────

const asgRes = (c: OpCtx) => `arn:aws:autoscaling:${c.region}:${c.acct.id}:autoScalingGroup:*:autoScalingGroupName/${c.p.AutoScalingGroupName ?? '*'}`;

function parseSubnets(c: OpCtx, zone: string | undefined, azs: string[] | undefined): { subnetIds: string[]; azs: string[] } {
  const r = regional(c.acct, c.region).ec2;
  if (zone) {
    const ids = zone.split(',').map((s) => s.trim()).filter(Boolean);
    for (const id of ids) if (!r.subnets[id]) throw E.val(`The subnet ID '${id}' does not exist`);
    const vpcs = new Set(ids.map((id) => r.subnets[id].VpcId));
    if (vpcs.size > 1) throw E.val('Subnets must belong to the same VPC');
    return { subnetIds: ids, azs: [...new Set(ids.map((id) => r.subnets[id].AvailabilityZone))] };
  }
  if (azs?.length) {
    const ids = azs.map((az) => Object.values(r.subnets).find((s) => s.AvailabilityZone === az && s.DefaultForAz)?.SubnetId ?? '').filter(Boolean);
    return { subnetIds: ids, azs };
  }
  throw E.val('At least one Availability Zone or VPC Subnet is required.');
}

export function asgCreate(a: Account, region: string, o: { name: string; lt: LaunchTemplate; min: number; max: number; desired?: number; subnetIds: string[]; tgs?: string[]; hc?: 'EC2' | 'ELB'; grace?: number; warmup?: number; tags?: (Tag & { PropagateAtLaunch?: boolean })[]; launch?: boolean }): Asg {
  const r = regional(a, region).ec2;
  const g: Asg = {
    AutoScalingGroupName: o.name,
    AutoScalingGroupARN: `arn:aws:autoscaling:${region}:${a.id}:autoScalingGroup:${uuid(a, 'asg:' + o.name)}:autoScalingGroupName/${o.name}`,
    LaunchTemplate: { LaunchTemplateId: o.lt.LaunchTemplateId, LaunchTemplateName: o.lt.LaunchTemplateName, Version: '$Default' },
    MinSize: o.min,
    MaxSize: o.max,
    DesiredCapacity: o.desired ?? o.min,
    DefaultCooldown: 300,
    AvailabilityZones: [...new Set(o.subnetIds.map((id) => r.subnets[id].AvailabilityZone))],
    subnetIds: o.subnetIds,
    TargetGroupARNs: o.tgs ?? [],
    HealthCheckType: o.hc ?? 'EC2',
    HealthCheckGracePeriod: o.grace ?? 0,
    DefaultInstanceWarmup: o.warmup ?? 300,
    CreatedTime: iso(a.clock),
    Tags: o.tags ?? [],
    SuspendedProcesses: [],
    policies: {},
    instances: [],
    activities: [],
    lastEval: a.clock,
    lastScale: 0,
    lowMinutes: 0,
    history: [],
  };
  asgs(a, region)[o.name] = g;
  if (o.launch !== false) maintain(a, region, g, a.clock, '');
  return g;
}

op('autoscaling', 'create-auto-scaling-group', 'auto-scaling-group-name:s! launch-template:j min-size:i! max-size:i! desired-capacity:i default-cooldown:i availability-zones:l target-group-arns:l health-check-type:s health-check-grace-period:i vpc-zone-identifier:s tags:f default-instance-warmup:i', 'Crea un grupo de Auto Scaling: mantiene un número de instancias repartidas entre zonas y las repone si fallan.', { res: asgRes }, (c) => {
  const name = String(c.p.AutoScalingGroupName);
  if (asgs(c.acct, c.region)[name]) throw new AwsError('AlreadyExists', `AutoScalingGroup by this name already exists - A group with the name ${name} already exists.`, 400);
  const ref = c.p.LaunchTemplate as { LaunchTemplateId?: string; LaunchTemplateName?: string; Version?: string } | undefined;
  if (!ref) throw E.val('Valid requests must contain either launchTemplate, launchConfigurationName, instanceId or mixedInstancesPolicy parameter.');
  const lt = findLt(c.acct, c.region, { id: ref.LaunchTemplateId, name: ref.LaunchTemplateName });
  if (ref.Version) resolveVersion(lt, ref.Version);
  const min = c.p.MinSize as number;
  const max = c.p.MaxSize as number;
  const desired = (c.p.DesiredCapacity as number | undefined) ?? min;
  if (min > max) throw E.val(`Minimum capacity ${min} must be less than or equal to maximum capacity ${max}.`);
  if (desired < min || desired > max) throw E.val(`Desired capacity:${desired} must be between the specified min size:${min} and max size:${max}`);
  const { subnetIds } = parseSubnets(c, c.p.VpcZoneIdentifier, c.p.AvailabilityZones);
  const tgs: string[] = c.p.TargetGroupArns ?? [];
  for (const arn of tgs) if (!elb(c.acct, c.region).tgs[arn]) throw E.val(`Provided Target Groups may not be valid. Please check your target group ARNs.`);
  const hc = (c.p.HealthCheckType ?? 'EC2') as 'EC2' | 'ELB';
  if (!['EC2', 'ELB'].includes(hc)) throw E.val(`Invalid health check type: ${hc}`);
  const g = asgCreate(c.acct, c.region, { name, lt, min, max, desired, subnetIds, tgs, hc, grace: c.p.HealthCheckGracePeriod, warmup: c.p.DefaultInstanceWarmup, tags: c.p.Tags, launch: false });
  if (ref.Version) g.LaunchTemplate.Version = ref.Version;
  if (c.p.DefaultCooldown !== undefined) g.DefaultCooldown = c.p.DefaultCooldown;
  maintain(c.acct, c.region, g, c.acct.clock, ` At ${isoZ(c.acct.clock)} a user request created an AutoScalingGroup changing the desired capacity from 0 to ${desired}.`);
  return undefined;
});

op('autoscaling', 'describe-auto-scaling-groups', 'auto-scaling-group-names:l', 'Lista los grupos de Auto Scaling y sus instancias.', { paginate: 'AutoScalingGroups', res: () => '*' }, (c) => {
  const all = Object.values(asgs(c.acct, c.region));
  const names = c.p.AutoScalingGroupNames as string[] | undefined;
  return { AutoScalingGroups: (names ? all.filter((g) => names.includes(g.AutoScalingGroupName)) : all).map((g) => asgView(c.acct, c.region, g)) };
});

op('autoscaling', 'describe-auto-scaling-instances', 'instance-ids:l', 'Lista las instancias que pertenecen a algún grupo.', { paginate: 'AutoScalingInstances', res: () => '*' }, (c) => {
  const out: unknown[] = [];
  for (const g of Object.values(asgs(c.acct, c.region))) for (const i of g.instances) if (!c.p.InstanceIds || (c.p.InstanceIds as string[]).includes(i.InstanceId)) out.push(instView(c.acct, c.region, g, i, true));
  return { AutoScalingInstances: out };
});

op('autoscaling', 'update-auto-scaling-group', 'auto-scaling-group-name:s! launch-template:j min-size:i max-size:i desired-capacity:i default-cooldown:i availability-zones:l health-check-type:s health-check-grace-period:i vpc-zone-identifier:s default-instance-warmup:i', 'Cambia los límites, la plantilla, las subredes o las comprobaciones de un grupo.', { res: asgRes }, (c) => {
  const g = findAsg(c.acct, c.region, c.p.AutoScalingGroupName);
  const min = c.p.MinSize ?? g.MinSize;
  const max = c.p.MaxSize ?? g.MaxSize;
  if (min > max) throw E.val(`Minimum capacity ${min} must be less than or equal to maximum capacity ${max}.`);
  let desired = c.p.DesiredCapacity ?? g.DesiredCapacity;
  if (c.p.DesiredCapacity !== undefined && (desired < min || desired > max)) throw E.val(`Desired capacity:${desired} must be between the specified min size:${min} and max size:${max}`);
  desired = Math.max(min, Math.min(max, desired));
  if (c.p.LaunchTemplate) {
    const ref = c.p.LaunchTemplate as { LaunchTemplateId?: string; LaunchTemplateName?: string; Version?: string };
    const lt = findLt(c.acct, c.region, { id: ref.LaunchTemplateId, name: ref.LaunchTemplateName });
    if (ref.Version) resolveVersion(lt, ref.Version);
    g.LaunchTemplate = { LaunchTemplateId: lt.LaunchTemplateId, LaunchTemplateName: lt.LaunchTemplateName, Version: ref.Version ?? '$Default' };
  }
  if (c.p.VpcZoneIdentifier || c.p.AvailabilityZones) {
    const s = parseSubnets(c, c.p.VpcZoneIdentifier, c.p.AvailabilityZones);
    g.subnetIds = s.subnetIds;
    g.AvailabilityZones = s.azs;
  }
  if (c.p.HealthCheckType) g.HealthCheckType = c.p.HealthCheckType;
  if (c.p.HealthCheckGracePeriod !== undefined) g.HealthCheckGracePeriod = c.p.HealthCheckGracePeriod;
  if (c.p.DefaultCooldown !== undefined) g.DefaultCooldown = c.p.DefaultCooldown;
  if (c.p.DefaultInstanceWarmup !== undefined) g.DefaultInstanceWarmup = c.p.DefaultInstanceWarmup;
  const prev = g.DesiredCapacity;
  g.MinSize = min;
  g.MaxSize = max;
  g.DesiredCapacity = desired;
  maintain(c.acct, c.region, g, c.acct.clock, ` At ${isoZ(c.acct.clock)} a user request update of AutoScalingGroup constraints to min: ${min}, max: ${max}, desired: ${desired} changing the desired capacity from ${prev} to ${desired}.`);
  return undefined;
});

op('autoscaling', 'set-desired-capacity', 'auto-scaling-group-name:s! desired-capacity:i! honor-cooldown:b', 'Fija a mano el número deseado de instancias (dentro de mínimo y máximo).', { res: asgRes }, (c) => {
  const g = findAsg(c.acct, c.region, c.p.AutoScalingGroupName);
  const n = c.p.DesiredCapacity as number;
  if (n < g.MinSize) throw E.val(`New SetDesiredCapacity value ${n} is below min value ${g.MinSize} for the AutoScalingGroup.`);
  if (n > g.MaxSize) throw E.val(`New SetDesiredCapacity value ${n} is above max value ${g.MaxSize} for the AutoScalingGroup.`);
  if (c.p.HonorCooldown && c.acct.clock - g.lastScale < g.DefaultCooldown * 1000 && g.lastScale) throw new AwsError('ScalingActivityInProgress', 'Cannot set desired capacity because a scaling activity is in progress (cooldown).', 400);
  const prev = g.DesiredCapacity;
  g.DesiredCapacity = n;
  g.lastScale = c.acct.clock;
  maintain(c.acct, c.region, g, c.acct.clock, ` At ${isoZ(c.acct.clock)} a user request explicitly set group desired capacity changing the desired capacity from ${prev} to ${n}.`);
  return undefined;
});

op('autoscaling', 'terminate-instance-in-auto-scaling-group', 'instance-id:s! should-decrement-desired-capacity:b', 'Termina una instancia del grupo (y, si quieres, reduce el deseado; si no, se repone).', { res: () => '*' }, (c) => {
  for (const g of Object.values(asgs(c.acct, c.region))) {
    const ai = g.instances.find((i) => i.InstanceId === c.p.InstanceId);
    if (!ai) continue;
    if (c.p.ShouldDecrementDesiredCapacity) {
      if (g.DesiredCapacity <= g.MinSize) throw new AwsError('ValidationError', `Cannot terminate instance and decrement desired capacity: it would go below the minimum size of the group (${g.MinSize}).`, 400);
      g.DesiredCapacity--;
    }
    terminateOne(c.acct, c.region, g, ai, c.acct.clock, `At ${isoZ(c.acct.clock)} instance ${ai.InstanceId} was taken out of service in response to a user request${c.p.ShouldDecrementDesiredCapacity ? ', shrinking the capacity' : ''}.`);
    const a = g.activities[0];
    return { Activity: { ...a } };
  }
  throw E.val(`Instance Id not found - No managed instance found for instance ID '${c.p.InstanceId}'`);
});

op('autoscaling', 'set-instance-health', 'instance-id:s! health-status:s! should-respect-grace-period:b', 'Marca una instancia como sana o enferma (si está enferma, el grupo la reemplaza).', { res: () => '*' }, (c) => {
  if (!['Healthy', 'Unhealthy'].includes(c.p.HealthStatus)) throw E.val(`Health status must be either Healthy or Unhealthy`);
  for (const g of Object.values(asgs(c.acct, c.region))) {
    const ai = g.instances.find((i) => i.InstanceId === c.p.InstanceId);
    if (ai) {
      ai.HealthStatus = c.p.HealthStatus;
      return undefined;
    }
  }
  throw E.val(`Instance Id not found - No managed instance found for instance ID '${c.p.InstanceId}'`);
});

op('autoscaling', 'set-instance-protection', 'instance-ids:l! auto-scaling-group-name:s! protected-from-scale-in:b', 'Protege instancias para que no se retiren al reducir el grupo.', { res: asgRes }, (c) => {
  const g = findAsg(c.acct, c.region, c.p.AutoScalingGroupName);
  for (const id of c.p.InstanceIds as string[]) {
    const ai = g.instances.find((i) => i.InstanceId === id);
    if (!ai) throw E.val(`The instance ${id} is not part of Auto Scaling group ${g.AutoScalingGroupName}.`);
    ai.ProtectedFromScaleIn = !!c.p.ProtectedFromScaleIn;
  }
  return undefined;
});

op('autoscaling', 'delete-auto-scaling-group', 'auto-scaling-group-name:s! force-delete:b', 'Borra un grupo (con --force-delete, también sus instancias).', { res: asgRes }, (c) => {
  const g = findAsg(c.acct, c.region, c.p.AutoScalingGroupName);
  if (inGroup(g).length && !c.p.ForceDelete) throw new AwsError('ResourceInUse', 'You cannot delete an AutoScalingGroup while there are instances or pending Spot instance request(s) still in the group.', 400);
  for (const ai of inGroup(g)) terminateOne(c.acct, c.region, g, ai, c.acct.clock, `At ${isoZ(c.acct.clock)} the group was force deleted.`);
  delete asgs(c.acct, c.region)[g.AutoScalingGroupName];
  for (const al of Object.keys(regional(c.acct, c.region).alarms)) if (al.startsWith(`TargetTracking-${g.AutoScalingGroupName}-`)) delete regional(c.acct, c.region).alarms[al];
  return undefined;
});

const PROCESSES = ['Launch', 'Terminate', 'HealthCheck', 'ReplaceUnhealthy', 'AZRebalance', 'AlarmNotification', 'ScheduledActions', 'AddToLoadBalancer', 'InstanceRefresh'];
op('autoscaling', 'suspend-processes', 'auto-scaling-group-name:s! scaling-processes:l', 'Suspende procesos del grupo (Launch, Terminate, HealthCheck, ReplaceUnhealthy, AZRebalance…).', { res: asgRes }, (c) => {
  const g = findAsg(c.acct, c.region, c.p.AutoScalingGroupName);
  const list: string[] = c.p.ScalingProcesses ?? PROCESSES;
  for (const p of list) if (!PROCESSES.includes(p)) throw E.val(`Invalid process name '${p}'. Valid: ${PROCESSES.join(', ')}`);
  g.SuspendedProcesses = [...new Set([...g.SuspendedProcesses, ...list])];
  return undefined;
});
op('autoscaling', 'resume-processes', 'auto-scaling-group-name:s! scaling-processes:l', 'Reanuda procesos suspendidos.', { res: asgRes }, (c) => {
  const g = findAsg(c.acct, c.region, c.p.AutoScalingGroupName);
  g.SuspendedProcesses = c.p.ScalingProcesses ? g.SuspendedProcesses.filter((p) => !(c.p.ScalingProcesses as string[]).includes(p)) : [];
  return undefined;
});

op('autoscaling', 'attach-load-balancer-target-groups', 'auto-scaling-group-name:s! target-group-arns:l!', 'Conecta un grupo de Auto Scaling a grupos de destino de un balanceador.', { res: asgRes }, (c) => {
  const g = findAsg(c.acct, c.region, c.p.AutoScalingGroupName);
  for (const arn of c.p.TargetGroupArns as string[]) {
    const tg = elb(c.acct, c.region).tgs[arn];
    if (!tg) throw E.val(`Provided Target Groups may not be valid. Please check your target group ARNs.`);
    if (!g.TargetGroupARNs.includes(arn)) g.TargetGroupARNs.push(arn);
    for (const i of g.instances) if (i.LifecycleState === 'InService' && !tg.targets.some((t) => t.Id === i.InstanceId)) tg.targets.push({ Id: i.InstanceId, Port: tg.Port, registeredAt: c.acct.clock });
  }
  return {};
});
op('autoscaling', 'detach-load-balancer-target-groups', 'auto-scaling-group-name:s! target-group-arns:l!', 'Desconecta el grupo de grupos de destino.', { res: asgRes }, (c) => {
  const g = findAsg(c.acct, c.region, c.p.AutoScalingGroupName);
  for (const arn of c.p.TargetGroupArns as string[]) {
    g.TargetGroupARNs = g.TargetGroupARNs.filter((x) => x !== arn);
    const tg = elb(c.acct, c.region).tgs[arn];
    if (tg) for (const i of g.instances) deregister(c.acct, tg, i.InstanceId);
  }
  return {};
});

op('autoscaling', 'describe-scaling-activities', 'auto-scaling-group-name:s activity-ids:l max-records:i', 'Historial de lo que ha hecho el grupo (lanzar, terminar…) y por qué.', { paginate: 'Activities', res: () => '*' }, (c) => {
  const groups = c.p.AutoScalingGroupName ? [findAsg(c.acct, c.region, c.p.AutoScalingGroupName)] : Object.values(asgs(c.acct, c.region));
  return { Activities: groups.flatMap((g) => g.activities.map((x) => ({ ActivityId: x.ActivityId, AutoScalingGroupName: g.AutoScalingGroupName, Description: x.Description, Cause: x.Cause, StartTime: x.StartTime, EndTime: x.EndTime, StatusCode: x.StatusCode, Progress: x.Progress, Details: '{"Subnet ID":"","Availability Zone":""}', AutoScalingGroupARN: g.AutoScalingGroupARN }))) };
});

op('autoscaling', 'put-scaling-policy', 'auto-scaling-group-name:s! policy-name:s! policy-type:s adjustment-type:s min-adjustment-magnitude:i scaling-adjustment:i cooldown:i metric-aggregation-type:s step-adjustments:f estimated-instance-warmup:i target-tracking-configuration:j enabled:b', 'Crea una política de escalado (seguimiento de objetivo, simple o por pasos).', { res: asgRes }, (c) => {
  const g = findAsg(c.acct, c.region, c.p.AutoScalingGroupName);
  const type = (c.p.PolicyType ?? 'SimpleScaling') as ScalingPolicy['PolicyType'];
  if (!['TargetTrackingScaling', 'SimpleScaling', 'StepScaling'].includes(type)) throw E.val(`1 validation error detected: Value '${type}' at 'policyType' failed to satisfy constraint: Member must satisfy enum value set: [TargetTrackingScaling, StepScaling, SimpleScaling, PredictiveScaling]`);
  const p: ScalingPolicy = { PolicyName: c.p.PolicyName, PolicyARN: policyArn(c.acct, c.region, g.AutoScalingGroupName, c.p.PolicyName), PolicyType: type, Enabled: c.p.Enabled !== false };
  const alarms: { AlarmName: string; AlarmARN: string }[] = [];
  if (type === 'TargetTrackingScaling') {
    const cfg = c.p.TargetTrackingConfiguration;
    if (!cfg?.TargetValue) throw E.val('TargetTrackingConfiguration is required for TargetTrackingScaling policies.');
    const kind = cfg.PredefinedMetricSpecification?.PredefinedMetricType;
    if (!['ASGAverageCPUUtilization', 'ALBRequestCountPerTarget'].includes(String(kind))) throw E.val(`Unsupported metric in this simulator: ${kind}. Use ASGAverageCPUUtilization or ALBRequestCountPerTarget.`);
    if (kind === 'ALBRequestCountPerTarget' && !cfg.PredefinedMetricSpecification?.ResourceLabel) throw E.val('ResourceLabel is required for ALBRequestCountPerTarget.');
    p.TargetTrackingConfiguration = { PredefinedMetricSpecification: cfg.PredefinedMetricSpecification, TargetValue: Number(cfg.TargetValue), ...(cfg.DisableScaleIn !== undefined ? { DisableScaleIn: cfg.DisableScaleIn === true || cfg.DisableScaleIn === 'true' } : {}) };
    p.EstimatedInstanceWarmup = c.p.EstimatedInstanceWarmup;
    const reg = regional(c.acct, c.region);
    const tag = `${md5(p.PolicyARN).slice(0, 8)}-${md5(p.PolicyARN).slice(8, 12)}`;
    for (const [suffix, periods, op_, act] of [['AlarmHigh', 3, 'GreaterThanThreshold', [p.PolicyARN]], ['AlarmLow', 15, 'LessThanThreshold', []]] as const) {
      const name = `TargetTracking-${g.AutoScalingGroupName}-${suffix}-${tag}`;
      reg.alarms[name] = { AlarmName: name, Namespace: kind === 'ALBRequestCountPerTarget' ? 'AWS/ApplicationELB' : 'AWS/EC2', MetricName: kind === 'ALBRequestCountPerTarget' ? 'RequestCountPerTarget' : 'CPUUtilization', Statistic: 'Average', Period: 60, EvaluationPeriods: periods, Threshold: Number(cfg.TargetValue) * (suffix === 'AlarmLow' ? 0.9 : 1), ComparisonOperator: op_, AlarmActions: [...act], Dimensions: kind === 'ALBRequestCountPerTarget' ? [] : [{ Name: 'AutoScalingGroupName', Value: g.AutoScalingGroupName }], AlarmDescription: `DO NOT EDIT OR DELETE. For TargetTrackingScaling policy ${p.PolicyARN}.`, StateValue: 'OK' };
      alarms.push({ AlarmName: name, AlarmARN: `arn:aws:cloudwatch:${c.region}:${c.acct.id}:alarm:${name}` });
    }
  } else {
    p.AdjustmentType = c.p.AdjustmentType;
    if (!['ChangeInCapacity', 'PercentChangeInCapacity', 'ExactCapacity'].includes(String(p.AdjustmentType))) throw E.val(`AdjustmentType is required (ChangeInCapacity, PercentChangeInCapacity or ExactCapacity).`);
    if (type === 'SimpleScaling') {
      if (c.p.ScalingAdjustment === undefined) throw E.val('ScalingAdjustment is required for SimpleScaling policies.');
      p.ScalingAdjustment = c.p.ScalingAdjustment;
      p.Cooldown = c.p.Cooldown;
    } else {
      if (!c.p.StepAdjustments?.length) throw E.val('StepAdjustments are required for StepScaling policies.');
      p.StepAdjustments = (c.p.StepAdjustments as any[]).map((s) => ({ ...(s.MetricIntervalLowerBound !== undefined ? { MetricIntervalLowerBound: Number(s.MetricIntervalLowerBound) } : {}), ...(s.MetricIntervalUpperBound !== undefined ? { MetricIntervalUpperBound: Number(s.MetricIntervalUpperBound) } : {}), ScalingAdjustment: Number(s.ScalingAdjustment) }));
      p.MetricAggregationType = c.p.MetricAggregationType ?? 'Average';
      p.EstimatedInstanceWarmup = c.p.EstimatedInstanceWarmup;
    }
  }
  g.policies[p.PolicyName] = p;
  return { PolicyARN: p.PolicyARN, Alarms: alarms };
});

op('autoscaling', 'describe-policies', 'auto-scaling-group-name:s policy-names:l', 'Lista las políticas de escalado.', { paginate: 'ScalingPolicies', res: () => '*' }, (c) => {
  const groups = c.p.AutoScalingGroupName ? [findAsg(c.acct, c.region, c.p.AutoScalingGroupName)] : Object.values(asgs(c.acct, c.region));
  return { ScalingPolicies: groups.flatMap((g) => Object.values(g.policies).filter((p) => !c.p.PolicyNames || (c.p.PolicyNames as string[]).includes(p.PolicyName)).map((p) => policyView(g, p))) };
});

op('autoscaling', 'delete-policy', 'auto-scaling-group-name:s policy-name:s!', 'Borra una política de escalado.', { res: () => '*' }, (c) => {
  for (const g of Object.values(asgs(c.acct, c.region))) {
    const p = g.policies[c.p.PolicyName];
    if (p && (!c.p.AutoScalingGroupName || c.p.AutoScalingGroupName === g.AutoScalingGroupName)) {
      delete g.policies[p.PolicyName];
      for (const al of Object.keys(regional(c.acct, c.region).alarms)) if (al.startsWith(`TargetTracking-${g.AutoScalingGroupName}-`) && regional(c.acct, c.region).alarms[al].AlarmDescription?.includes(p.PolicyARN)) delete regional(c.acct, c.region).alarms[al];
      return undefined;
    }
  }
  throw new AwsError('ValidationError', `No policy found for the given name: ${c.p.PolicyName}`, 400);
});

op('autoscaling', 'execute-policy', 'auto-scaling-group-name:s policy-name:s! honor-cooldown:b metric-value:n breach-threshold:n', 'Ejecuta a mano una política simple o por pasos.', { res: () => '*' }, (c) => {
  const g = findAsg(c.acct, c.region, c.p.AutoScalingGroupName);
  const p = g.policies[c.p.PolicyName];
  if (!p) throw new AwsError('ValidationError', `No policy found for the given name: ${c.p.PolicyName}`, 400);
  if (p.PolicyType === 'TargetTrackingScaling') throw E.val('Target tracking policies cannot be executed manually.');
  if (c.p.HonorCooldown && g.lastScale && c.acct.clock - g.lastScale < (p.Cooldown ?? g.DefaultCooldown) * 1000) throw new AwsError('ScalingActivityInProgress', 'Policy is in cooldown.', 400);
  let adj = p.ScalingAdjustment ?? 0;
  if (p.PolicyType === 'StepScaling') {
    const breach = (c.p.MetricValue ?? 0) - (c.p.BreachThreshold ?? 0);
    const s = (p.StepAdjustments ?? []).find((x) => (x.MetricIntervalLowerBound === undefined || breach >= x.MetricIntervalLowerBound) && (x.MetricIntervalUpperBound === undefined || breach < x.MetricIntervalUpperBound));
    if (!s) return undefined;
    adj = s.ScalingAdjustment;
  }
  const cur = g.DesiredCapacity;
  const next = p.AdjustmentType === 'PercentChangeInCapacity' ? cur + (adj >= 0 ? Math.max(1, Math.ceil((cur * adj) / 100)) : -Math.max(1, Math.ceil((cur * -adj) / 100))) : p.AdjustmentType === 'ExactCapacity' ? adj : cur + adj;
  setDesired(c.acct, g, next, c.acct.clock, 'manual');
  maintain(c.acct, c.region, g, c.acct.clock, ` A policy changed the desired capacity from ${cur} to ${g.DesiredCapacity}.`);
  return undefined;
});

op('autoscaling', 'put-scheduled-update-group-action', 'auto-scaling-group-name:s! scheduled-action-name:s! start-time:s recurrence:s min-size:i max-size:i desired-capacity:i', 'Programa un cambio de mínimo, máximo o deseado a una hora (o repetido con cron).', { res: asgRes }, (c) => {
  const g = findAsg(c.acct, c.region, c.p.AutoScalingGroupName);
  if (!c.p.StartTime && !c.p.Recurrence) throw E.val('Either StartTime or Recurrence must be specified.');
  g.scheduled = (g.scheduled ?? []).filter((s) => s.ScheduledActionName !== c.p.ScheduledActionName);
  g.scheduled.push({ ScheduledActionName: c.p.ScheduledActionName, StartTime: c.p.StartTime, Recurrence: c.p.Recurrence, MinSize: c.p.MinSize, MaxSize: c.p.MaxSize, DesiredCapacity: c.p.DesiredCapacity });
  return undefined;
});
op('autoscaling', 'describe-scheduled-actions', 'auto-scaling-group-name:s', 'Lista las acciones programadas.', { paginate: 'ScheduledUpdateGroupActions', res: () => '*' }, (c) => {
  const groups = c.p.AutoScalingGroupName ? [findAsg(c.acct, c.region, c.p.AutoScalingGroupName)] : Object.values(asgs(c.acct, c.region));
  return { ScheduledUpdateGroupActions: groups.flatMap((g) => (g.scheduled ?? []).map((s) => ({ AutoScalingGroupName: g.AutoScalingGroupName, ScheduledActionName: s.ScheduledActionName, ScheduledActionARN: `arn:aws:autoscaling:${c.region}:${c.acct.id}:scheduledUpdateGroupAction:${uuid(c.acct, 'sch')}:autoScalingGroupName/${g.AutoScalingGroupName}:scheduledActionName/${s.ScheduledActionName}`, ...(s.StartTime ? { StartTime: s.StartTime, Time: s.StartTime } : {}), ...(s.Recurrence ? { Recurrence: s.Recurrence } : {}), ...(s.MinSize !== undefined ? { MinSize: s.MinSize } : {}), ...(s.MaxSize !== undefined ? { MaxSize: s.MaxSize } : {}), ...(s.DesiredCapacity !== undefined ? { DesiredCapacity: s.DesiredCapacity } : {}) }))) };
});
op('autoscaling', 'delete-scheduled-action', 'auto-scaling-group-name:s! scheduled-action-name:s!', 'Borra una acción programada.', { res: asgRes }, (c) => {
  const g = findAsg(c.acct, c.region, c.p.AutoScalingGroupName);
  g.scheduled = (g.scheduled ?? []).filter((s) => s.ScheduledActionName !== c.p.ScheduledActionName);
  return undefined;
});

