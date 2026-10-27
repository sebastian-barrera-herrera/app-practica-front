/** AWS CodeDeploy para funciones Lambda: despliegues con tráfico gradual (canario, lineal, todo de golpe), ganchos de validación, alarmas y retroceso automático. */
import { regional } from '../account';
import { AwsError, op, type OpCtx } from '../registry';
import { sdkCall } from '../sdk';
import { tickers } from '../tick';
import type { Account, CdDeployment, CdState, Rec } from '../types';
import { isObj, stableId, toArr } from '../util';
import { parseTemplate } from '../yaml';
import { roleCan, roleTrusts } from './flowlogs';
import { cicdOf } from './codebuild';

const cdErr = (code: string, m: string) => new AwsError(code, m, 400);

/** Configuraciones de despliegue predefinidas para Lambda: [tipo, porcentaje, minutos]. */
const CONFIGS: Record<string, { type: 'AllAtOnce' | 'Canary' | 'Linear'; pct: number; minutes: number }> = {
  'CodeDeployDefault.LambdaAllAtOnce': { type: 'AllAtOnce', pct: 100, minutes: 0 },
  'CodeDeployDefault.LambdaCanary10Percent5Minutes': { type: 'Canary', pct: 10, minutes: 5 },
  'CodeDeployDefault.LambdaCanary10Percent10Minutes': { type: 'Canary', pct: 10, minutes: 10 },
  'CodeDeployDefault.LambdaCanary10Percent15Minutes': { type: 'Canary', pct: 10, minutes: 15 },
  'CodeDeployDefault.LambdaCanary10Percent30Minutes': { type: 'Canary', pct: 10, minutes: 30 },
  'CodeDeployDefault.LambdaLinear10PercentEvery1Minute': { type: 'Linear', pct: 10, minutes: 1 },
  'CodeDeployDefault.LambdaLinear10PercentEvery2Minutes': { type: 'Linear', pct: 10, minutes: 2 },
  'CodeDeployDefault.LambdaLinear10PercentEvery3Minutes': { type: 'Linear', pct: 10, minutes: 3 },
  'CodeDeployDefault.LambdaLinear10PercentEvery10Minutes': { type: 'Linear', pct: 10, minutes: 10 },
};

const cdOf = (a: Account, region: string): CdState => cicdOf(a, region).cd;
const depId = (seed: string) => stableId(seed, 'd-', 9, 'up');

interface DeployExt extends CdDeployment {
  fn?: string;
  hookExec?: Record<string, { id: string; status?: 'Succeeded' | 'Failed' }>;
  groupKey: string;
  after?: string;
  stopped?: boolean;
}

const view = (a: Account, d: DeployExt) => {
  const st = status(a, d);
  return {
    applicationName: d.application,
    deploymentGroupName: d.group,
    deploymentConfigName: d.config,
    deploymentId: d.id,
    revision: { revisionType: 'AppSpecContent' },
    status: st,
    ...(st === 'Failed' || st === 'Stopped' ? { errorInformation: { code: d.error?.split(':')[0] ?? 'ERROR', message: d.error?.split(': ').slice(1).join(': ') ?? '' } } : {}),
    createTime: d.startedAt / 1000,
    ...(st !== 'Created' ? { startTime: (d.startedAt + 2000) / 1000 } : {}),
    ...(st === 'Succeeded' || st === 'Failed' || st === 'Stopped' ? { completeTime: (d.steps.length ? d.steps[d.steps.length - 1].at + 5000 : d.startedAt + 5000) / 1000 } : {}),
    deploymentOverview: { Pending: 0, InProgress: st === 'InProgress' ? 1 : 0, Succeeded: st === 'Succeeded' ? 1 : 0, Failed: st === 'Failed' ? 1 : 0, Skipped: 0, Ready: 0 },
    description: d.revision === 'inline' ? undefined : undefined,
    creator: 'user',
    ignoreApplicationStopFailures: false,
    autoRollbackConfiguration: {},
    updateOutdatedInstancesOnly: false,
    fileExistsBehavior: 'DISALLOW',
    computePlatform: 'Lambda',
  };
};

function status(a: Account, d: DeployExt): CdDeployment['status'] {
  if (d.status === 'Failed' || d.status === 'Stopped') return d.status;
  if (d.status === 'Succeeded') return d.steps.length && a.clock < d.steps[d.steps.length - 1].at ? 'InProgress' : 'Succeeded';
  return 'InProgress';
}


function updateAlias(a: Account, region: string, fn: string, alias: string, version: string, extra?: string, weight?: number): { ok: boolean; msg?: string } {
  const r = sdkCall(a, region, null, 'lambda', 'update-alias', { FunctionName: fn, Name: alias, FunctionVersion: version, RoutingConfig: extra ? { AdditionalVersionWeights: { [extra]: weight ?? 0 } } : { AdditionalVersionWeights: {} } });
  return { ok: r.ok, msg: r.error?.Message };
}

function runHook(a: Account, region: string, d: DeployExt, hookName: string, fnName: string): string | undefined {
  const execId = stableId(`${d.id}:${hookName}`, '', 24, 'hex');
  (d.hookExec ??= {})[hookName] = { id: execId };
  const r = sdkCall(a, region, null, 'lambda', 'invoke', { FunctionName: fnName, Payload: JSON.stringify({ DeploymentId: d.id, LifecycleEventHookExecutionId: execId }) });
  if (!r.ok) return `SCRIPT_FAILED: The ${hookName} hook function ${fnName} could not be invoked: ${r.error?.Message}`;
  if (r.data?.FunctionError) return `SCRIPT_FAILED: The ${hookName} hook function ${fnName} failed: ${String(r.data.Payload).slice(0, 200)}`;
  const s = d.hookExec[hookName].status;
  if (s === 'Succeeded') return undefined;
  if (s === 'Failed') return `SCRIPT_FAILED: The ${hookName} hook function ${fnName} reported Failed (validation did not pass).`;
  return `SCRIPT_FAILED: The ${hookName} hook function ${fnName} ran but did not report a status: call put_lifecycle_event_hook_execution_status(deploymentId, lifecycleEventHookExecutionId, status='Succeeded'|'Failed').`;
}

interface AppSpec {
  fn: string;
  alias: string;
  current: string;
  target: string;
  before?: string;
  after?: string;
}

function parseSpec(text: string): AppSpec {
  let doc: Rec;
  try {
    doc = parseTemplate(text);
  } catch (e) {
    throw cdErr('InvalidRevisionException', `The AppSpec content is not valid: ${(e as Error).message}`);
  }
  const res = toArr<Rec>(doc.Resources as Rec[]);
  const entry = res[0] && isObj(res[0]) ? Object.values(res[0])[0] : undefined;
  const p = (isObj(entry) ? ((entry as Rec).Properties as Rec | undefined) : undefined) ?? {};
  for (const k of ['Name', 'Alias', 'CurrentVersion', 'TargetVersion']) if (p[k] === undefined) throw cdErr('InvalidRevisionException', `The AppSpec is missing Resources[0].Properties.${k}.`);
  const hooks: Record<string, string> = {};
  for (const h of toArr<Rec>(doc.Hooks as Rec[])) for (const [k, v] of Object.entries(h)) hooks[k] = String(v);
  return { fn: String(p.Name), alias: String(p.Alias), current: String(p.CurrentVersion), target: String(p.TargetVersion), before: hooks.BeforeAllowTraffic, after: hooks.AfterAllowTraffic };
}

/** Lanza un despliegue de Lambda: valida, corre el gancho previo y programa los pasos de tráfico. */
export function startDeployment(a: Account, region: string, o: { app: string; group: string; spec: string; config?: string; description?: string }): DeployExt {
  const st = cdOf(a, region);
  const app = st.apps[o.app];
  if (!app) throw cdErr('ApplicationDoesNotExistException', `No application found for name: ${o.app}`);
  const g = app.groups[o.group];
  if (!g) throw cdErr('DeploymentGroupDoesNotExistException', `Deployment group name: ${o.group} not found for application: ${o.app}`);
  if (app.platform !== 'Lambda') throw cdErr('InvalidComputePlatformException', `The ${app.platform} compute platform is not supported in this simulator (use Lambda).`);
  const spec = parseSpec(o.spec);
  const cfgName = o.config ?? g.config;
  const cfg = CONFIGS[cfgName];
  if (!cfg) throw cdErr('DeploymentConfigDoesNotExistException', `The deployment configuration does not exist: ${cfgName}`);
  const id = depId(`${a.id}:${o.app}:${a.clock}:${Object.keys(st.deployments).length}`);
  const d: DeployExt = { id, application: o.app, group: o.group, groupKey: `${o.app}/${o.group}`, startedAt: a.clock, status: 'InProgress', config: cfgName, alias: spec.alias, from: spec.current, to: spec.target, steps: [], hooks: [], revision: 'inline' };
  st.deployments[id] = d;
  const fail = (code: string, msg: string) => {
    d.status = 'Failed';
    d.error = `${code}: ${msg}`;
    return d;
  };
  // permisos y recursos
  if (!roleTrusts(a, g.serviceRole, 'codedeploy.amazonaws.com') || !roleCan(a, g.serviceRole, ['lambda:UpdateAlias', 'lambda:GetAlias', 'lambda:InvokeFunction'], `arn:aws:lambda:${region}:${a.id}:function:${spec.fn}`)) {
    return fail('IAM_ROLE_PERMISSIONS', `CodeDeploy does not have the permissions required to assume the role ${g.serviceRole} (attach AWSCodeDeployRoleForLambda and trust codedeploy.amazonaws.com).`);
  }
  const lam = regional(a, region).lambda?.functions?.[spec.fn];
  if (!lam) return fail('INVALID_REVISION', `The Lambda function ${spec.fn} was not found.`);
  const al = lam.aliases[spec.alias];
  if (!al) return fail('INVALID_REVISION', `The alias ${spec.alias} of function ${spec.fn} was not found.`);
  if (!lam.versions.some((v) => v.Version === spec.target)) return fail('INVALID_REVISION', `Version ${spec.target} of function ${spec.fn} was not found.`);
  if (al.FunctionVersion !== spec.current) return fail('INVALID_REVISION', `The alias ${spec.alias} points to version ${al.FunctionVersion}, but the AppSpec says CurrentVersion is ${spec.current}.`);
  if (al.RoutingConfig && Object.keys(al.RoutingConfig.AdditionalVersionWeights).length) return fail('INVALID_REVISION', `The alias ${spec.alias} already has a traffic-shifting configuration: another deployment is in progress.`);
  // gancho previo
  if (spec.before) {
    const err = runHook(a, region, d, 'BeforeAllowTraffic', spec.before);
    if (err) return fail(err.split(':')[0], err.split(': ').slice(1).join(': '));
  }
  d.fn = spec.fn;
  d.after = spec.after;
  d.hooks = [spec.before, spec.after].filter(Boolean).map((n) => ({ name: String(n), fn: String(n) }));
  // calendario del tráfico
  const t0 = a.clock + 10000;
  const min = 60000;
  if (cfg.type === 'AllAtOnce') d.steps = [{ at: t0, weight: 1 }];
  else if (cfg.type === 'Canary') d.steps = [{ at: t0, weight: cfg.pct / 100 }, { at: t0 + cfg.minutes * min, weight: 1 }];
  else for (let w = cfg.pct, k = 0; w <= 100; w += cfg.pct, k++) d.steps.push({ at: t0 + k * cfg.minutes * min, weight: Math.min(1, w / 100) });
  applyDeployment(a, region, d, g);
  return d;
}

/** Aplica los pasos que ya tocan (según el reloj), vigila las alarmas y cierra el despliegue. */
function applyDeployment(a: Account, region: string, d: DeployExt, g?: CdState['apps'][string]['groups'][string]): void {
  if (d.status !== 'InProgress') return;
  const alias = String(d.alias);
  const fn = d.fn;
  if (!fn) return;
  const grp = g ?? cdOf(a, region).apps[d.application]?.groups[d.group];
  // alarmas: si alguna salta con el tráfico repartido, el despliegue se detiene
  const alarms = grp?.alarms ?? [];
  const alarmed = alarms.find((n) => regional(a, region).alarms?.[n]?.StateValue === 'ALARM');
  const applied = d.steps.filter((s) => s.at <= a.clock);
  const last = applied[applied.length - 1];
  if (last) {
    if (alarmed && last.weight < 1 && applied.length > 0) {
      d.status = 'Failed';
      d.error = 'ALARM_ACTIVE: One or more alarms have been activated.';
      if (grp?.autoRollback) updateAlias(a, region, fn, alias, String(d.from));
      else updateAlias(a, region, fn, alias, String(d.from), String(d.to), last.weight);
      return;
    }
    if (last.weight >= 1) updateAlias(a, region, fn, alias, String(d.to));
    else updateAlias(a, region, fn, alias, String(d.from), String(d.to), last.weight);
  }
  if (last && last.weight >= 1 && d.steps.every((s) => s.at <= a.clock)) {
    if (d.after) {
      const err = runHook(a, region, d, 'AfterAllowTraffic', d.after);
      if (err) {
        d.status = 'Failed';
        d.error = err;
        if (grp?.autoRollback) updateAlias(a, region, fn, alias, String(d.from));
        return;
      }
      d.after = undefined;
    }
    d.status = 'Succeeded';
  }
}

tickers.push((a) => {
  for (const [region, r] of Object.entries(a.regions)) for (const d of Object.values(r.cicd?.cd.deployments ?? {})) applyDeployment(a, region, d as DeployExt);
});

// ───────────────────────── operaciones (CLI: `aws deploy …`) ─────────────────────────

const findApp = (c: OpCtx, name: string) => {
  const app = cdOf(c.acct, c.region).apps[name];
  if (!app) throw cdErr('ApplicationDoesNotExistException', `No application found for name: ${name}`);
  return app;
};

op('deploy', 'create-application', 'application-name:s! compute-platform:s', 'Crea una aplicación de CodeDeploy (la plataforma por defecto es Server; usa `Lambda` para funciones).', { res: () => '*' }, (c) => {
  const st = cdOf(c.acct, c.region);
  const name = String(c.p.ApplicationName);
  if (st.apps[name]) throw cdErr('ApplicationAlreadyExistsException', `Application ${name} already exists`);
  const platform = c.p.ComputePlatform ?? 'Server';
  if (!['Server', 'Lambda', 'ECS'].includes(platform)) throw cdErr('InvalidComputePlatformException', `Invalid compute platform ${platform}. Valid: Server, Lambda, ECS.`);
  st.apps[name] = { name, platform, groups: {} };
  return { applicationId: stableId(`app:${c.acct.id}:${name}`, '', 32, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5') };
});
op('deploy', 'get-application', 'application-name:s!', 'Datos de una aplicación.', { res: () => '*' }, (c) => {
  const a = findApp(c, c.p.ApplicationName);
  return { application: { applicationId: stableId(`app:${c.acct.id}:${a.name}`, '', 32, 'hex'), applicationName: a.name, createTime: c.acct.clock / 1000, linkedToGitHub: false, computePlatform: a.platform } };
});
op('deploy', 'list-applications', '', 'Nombres de las aplicaciones.', { res: () => '*', paginate: 'applications' }, (c) => ({ applications: Object.keys(cdOf(c.acct, c.region).apps).sort() }));
op('deploy', 'delete-application', 'application-name:s!', 'Borra una aplicación (y sus grupos).', { res: () => '*' }, (c) => {
  findApp(c, c.p.ApplicationName);
  delete cdOf(c.acct, c.region).apps[c.p.ApplicationName];
  return undefined;
});

op('deploy', 'create-deployment-group', 'application-name:s! deployment-group-name:s! service-role-arn:s! deployment-config-name:s auto-rollback-configuration:j alarm-configuration:j deployment-style:j', 'Crea un grupo de despliegue: qué rol usa CodeDeploy, cómo reparte el tráfico, qué alarmas vigila y cuándo vuelve atrás solo.', { res: () => '*' }, (c) => {
  const app = findApp(c, c.p.ApplicationName);
  const name = String(c.p.DeploymentGroupName);
  if (app.groups[name]) throw cdErr('DeploymentGroupAlreadyExistsException', `Deployment group already exists: ${name}`);
  const role = String(c.p.ServiceRoleArn);
  if (!c.acct.iam.roles[role.split('/').pop() ?? ''] || !role.startsWith('arn:aws:iam::')) throw cdErr('InvalidRoleException', `The service role ${role} is invalid or does not exist.`);
  if (!roleTrusts(c.acct, role, 'codedeploy.amazonaws.com')) throw cdErr('InvalidRoleException', `CodeDeploy cannot assume the role ${role}: its trust policy must allow codedeploy.amazonaws.com.`);
  const cfg = c.p.DeploymentConfigName ?? (app.platform === 'Lambda' ? 'CodeDeployDefault.LambdaAllAtOnce' : 'CodeDeployDefault.OneAtATime');
  if (app.platform === 'Lambda' && !CONFIGS[cfg]) throw cdErr('DeploymentConfigDoesNotExistException', `The deployment configuration does not exist: ${cfg}`);
  const roll = c.p.AutoRollbackConfiguration as { enabled?: boolean | string; events?: string[] } | undefined;
  const alm = c.p.AlarmConfiguration as { enabled?: boolean | string; alarms?: { name: string }[] } | undefined;
  const alarms = alm && (alm.enabled === true || alm.enabled === 'true') ? toArr<{ name: string }>(alm.alarms).map((x) => x.name) : [];
  app.groups[name] = { name, serviceRole: role, config: cfg, alarms, autoRollback: !!roll && (roll.enabled === true || roll.enabled === 'true') };
  return { deploymentGroupId: stableId(`grp:${c.acct.id}:${app.name}:${name}`, '', 32, 'hex') };
});
op('deploy', 'get-deployment-group', 'application-name:s! deployment-group-name:s!', 'Datos de un grupo de despliegue.', { res: () => '*' }, (c) => {
  const app = findApp(c, c.p.ApplicationName);
  const g = app.groups[c.p.DeploymentGroupName];
  if (!g) throw cdErr('DeploymentGroupDoesNotExistException', `Deployment group name: ${c.p.DeploymentGroupName} not found for application: ${app.name}`);
  return { deploymentGroupInfo: { applicationName: app.name, deploymentGroupName: g.name, deploymentConfigName: g.config, serviceRoleArn: g.serviceRole, computePlatform: app.platform, autoRollbackConfiguration: { enabled: g.autoRollback, events: g.autoRollback ? ['DEPLOYMENT_FAILURE', 'DEPLOYMENT_STOP_ON_ALARM'] : [] }, alarmConfiguration: { enabled: !!g.alarms?.length, alarms: (g.alarms ?? []).map((name) => ({ name })) } } };
});
op('deploy', 'list-deployment-groups', 'application-name:s!', 'Grupos de despliegue de una aplicación.', { res: () => '*', paginate: 'deploymentGroups' }, (c) => ({ applicationName: c.p.ApplicationName, deploymentGroups: Object.keys(findApp(c, c.p.ApplicationName).groups).sort() }));
op('deploy', 'list-deployment-configs', '', 'Configuraciones de despliegue (reparto de tráfico) disponibles.', { res: () => '*', paginate: 'deploymentConfigsList' }, () => ({ deploymentConfigsList: Object.keys(CONFIGS).sort() }));

op('deploy', 'create-deployment', 'application-name:s! deployment-group-name:s deployment-config-name:s description:s revision:j', 'Lanza un despliegue con un AppSpec (en la propia llamada o en un objeto de S3). En Lambda mueve el alias de la versión actual a la nueva con el reparto de tráfico configurado.', { res: () => '*' }, (c) => {
  const rev = (c.p.Revision ?? {}) as { revisionType?: string; appSpecContent?: { content?: string }; s3Location?: { bucket?: string; key?: string } };
  let spec: string | undefined;
  if (rev.appSpecContent?.content) spec = rev.appSpecContent.content;
  else if (rev.s3Location?.bucket) {
    const b = c.acct.s3.buckets[rev.s3Location.bucket];
    const v = b?.objects[rev.s3Location.key ?? '']?.slice(-1)[0];
    if (!v) throw cdErr('InvalidRevisionException', `The revision s3://${rev.s3Location.bucket}/${rev.s3Location.key} could not be read.`);
    spec = v.body;
  }
  if (!spec) throw cdErr('InvalidRevisionException', 'A revision with appSpecContent or an s3Location is required.');
  const busy = Object.values(cdOf(c.acct, c.region).deployments).find((x) => x.application === c.p.ApplicationName && x.group === (c.p.DeploymentGroupName ?? '') && status(c.acct, x as DeployExt) === 'InProgress');
  if (busy) throw cdErr('DeploymentLimitExceededException', `The deployment ${busy.id} is still in progress for deployment group ${busy.group}: wait for it to finish or stop it with stop-deployment.`);
  const d = startDeployment(c.acct, c.region, { app: c.p.ApplicationName, group: c.p.DeploymentGroupName ?? '', spec, config: c.p.DeploymentConfigName, description: c.p.Description });
  return { deploymentId: d.id };
});

const findDep = (c: OpCtx, id: string): DeployExt => {
  const d = cdOf(c.acct, c.region).deployments[id] as DeployExt | undefined;
  if (!d) throw cdErr('DeploymentDoesNotExistException', `The deployment ${id} does not exist.`);
  applyDeployment(c.acct, c.region, d);
  return d;
};

op('deploy', 'get-deployment', 'deployment-id:s!', 'Estado del despliegue: `InProgress`, `Succeeded`, `Failed` (con `errorInformation`).', { res: () => '*' }, (c) => ({ deploymentInfo: view(c.acct, findDep(c, c.p.DeploymentId)) }));
op('deploy', 'batch-get-deployments', 'deployment-ids:l!', 'Datos de varios despliegues.', { res: () => '*' }, (c) => ({ deploymentsInfo: toArr<string>(c.p.DeploymentIds).map((i) => view(c.acct, findDep(c, i))) }));
op('deploy', 'list-deployments', 'application-name:s deployment-group-name:s', 'Ids de los despliegues, el más reciente primero.', { res: () => '*', paginate: 'deployments' }, (c) => ({ deployments: Object.values(cdOf(c.acct, c.region).deployments).filter((d) => (!c.p.ApplicationName || d.application === c.p.ApplicationName) && (!c.p.DeploymentGroupName || d.group === c.p.DeploymentGroupName)).sort((x, y) => y.startedAt - x.startedAt).map((d) => d.id) }));

op('deploy', 'stop-deployment', 'deployment-id:s! auto-rollback-enabled:b', 'Detiene un despliegue en curso (y, con `--auto-rollback-enabled`, devuelve el tráfico a la versión anterior).', { res: () => '*' }, (c) => {
  const d = findDep(c, c.p.DeploymentId);
  if (status(c.acct, d) !== 'InProgress') return { status: 'Failed', statusMessage: 'Deployment already completed.' };
  d.status = 'Stopped';
  d.error = 'USER_STOPPED: The deployment was stopped by a user.';
  if (c.p.AutoRollbackEnabled) {
    if (d.fn) updateAlias(c.acct, c.region, d.fn, String(d.alias), String(d.from));
  }
  return { status: 'Succeeded', statusMessage: 'No rollback was needed.' };
});

op('deploy', 'put-lifecycle-event-hook-execution-status', 'deployment-id:s! lifecycle-event-hook-execution-id:s! status:s', 'La función de un gancho informa a CodeDeploy de si la validación pasó (`Succeeded`) o no (`Failed`).', { res: () => '*' }, (c) => {
  const d = cdOf(c.acct, c.region).deployments[c.p.DeploymentId] as DeployExt | undefined;
  if (!d) throw cdErr('DeploymentDoesNotExistException', `The deployment ${c.p.DeploymentId} does not exist.`);
  const h = Object.values(d.hookExec ?? {}).find((x) => x.id === c.p.LifecycleEventHookExecutionId);
  if (!h) throw cdErr('InvalidLifecycleEventHookExecutionIdException', 'The lifecycle event hook execution id is not valid.');
  if (!['Succeeded', 'Failed', 'Pending', 'InProgress', 'Skipped', 'Unknown'].includes(c.p.Status)) throw cdErr('InvalidLifecycleEventHookExecutionStatusException', `Invalid status ${c.p.Status}.`);
  h.status = c.p.Status === 'Succeeded' ? 'Succeeded' : 'Failed';
  return { lifecycleEventHookExecutionId: h.id };
});

op('deploy', 'wait', 'waiter:s! deployment-id:s!', 'Espera a que el despliegue termine (`deployment-successful`).', { positional: ['waiter'], res: () => '*', authz: false }, (c) => {
  if (c.p.Waiter !== 'deployment-successful') throw new AwsError('InvalidWaiter', `Invalid choice: '${c.p.Waiter}', valid choices are: deployment-successful`, 252);
  for (let k = 0; k < 360; k++) {
    const d = findDep(c, c.p.DeploymentId);
    const s = status(c.acct, d);
    if (s === 'Succeeded') return undefined;
    if (s === 'Failed' || s === 'Stopped') throw new AwsError('WaiterError', `Waiter DeploymentSuccessful failed: Waiter encountered a terminal failure state: For expression "deploymentInfo.status" we matched expected path: "${s}"`, 255);
    c.acct.clock += 15000;
  }
  throw new AwsError('WaiterError', 'Waiter DeploymentSuccessful failed: Max attempts exceeded', 255);
});

