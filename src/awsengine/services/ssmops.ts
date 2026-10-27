/** Systems Manager: ventanas de mantenimiento (Maintenance Windows) y asociaciones de State Manager (tareas programadas sobre instancias). */
import { AwsError, op } from '../registry';
import { tickers } from '../tick';
import type { Account } from '../types';
import type { SsmAssociation, SsmWindow } from '../types-ops';
import { iso, mkArn, newId, toArr } from '../util';
import { cronMatches, parseRate, validSchedule } from './events';
import { roleTrusts } from './flowlogs';
import { resolveTargets, sendCommand, ssmOf, ssmStatus, commandDocs, customCommandDoc, normTargets } from './ssm';
import { regional } from '../account';
import { automationStart } from './ssmdocs';
import { tagHooks } from './ssmparams';

type Targets = { Key: string; Values: string[] }[];
const MIN = 60000;

const windowsOf = (a: Account, region: string): Record<string, SsmWindow> => (ssmOf(a, region).windows ??= {});
const assocsOf = (a: Account, region: string): Record<string, SsmAssociation> => (ssmOf(a, region).assocs ??= {});
const hex = (a: Account, kind: string, len: number) => newId(a, kind, '', len, 'hex');

const checkSchedule = (expr: string): void => {
  if (!validSchedule(expr)) throw new AwsError('ValidationException', `Schedule expression ${expr} is not valid: use cron(Minutes Hours Day-of-month Month Day-of-week Year) or rate(N minutes|hours|days).`, 400);
};

/** Instantes (minutos) entre `from` y `to` en que la programación dispara. */
function firesBetween(expr: string, last: number, to: number): number[] {
  const period = parseRate(expr);
  const out: number[] = [];
  if (period) {
    for (let t = last + period; t <= to && out.length < 50; t += period) out.push(t);
    return out;
  }
  const start = Math.floor(last / MIN) * MIN + MIN;
  const span = Math.min(to, start + 2000 * MIN);
  for (let t = start; t <= span; t += MIN) if (cronMatches(expr, t)) out.push(t);
  return out;
}

// ───────────────────────── ventanas de mantenimiento ─────────────────────────

const winArn = (c: { acct: Account; region: string }, id: string) => mkArn('ssm', c.region, c.acct.id, `maintenancewindow/${id}`);

const winOf = (c: { acct: Account; region: string; p: Record<string, any> }, id = c.p.WindowId): SsmWindow => {
  const w = windowsOf(c.acct, c.region)[id];
  if (!w) throw new AwsError('DoesNotExistException', `Maintenance window ${id} does not exist.`, 400);
  return w;
};

tagHooks.MaintenanceWindow = (c, id) => (windowsOf(c.acct, c.region)[id] ? {} : undefined);

op('ssm', 'create-maintenance-window', 'name:s! description:s start-date:s end-date:s schedule:s! schedule-timezone:s schedule-offset:i duration:i! cutoff:i! allow-unassociated-targets:b! client-token:s tags:f', 'Crea una ventana de mantenimiento: un horario (cron o rate) en el que se ejecutan tareas sobre tus instancias.', { action: 'ssm:CreateMaintenanceWindow', res: () => '*' }, (c) => {
  checkSchedule(String(c.p.Schedule));
  if (c.p.Duration < 1 || c.p.Duration > 24) throw new AwsError('ValidationException', 'Duration must be between 1 and 24 hours.', 400);
  if (c.p.Cutoff < 0 || c.p.Cutoff >= c.p.Duration) throw new AwsError('ValidationException', 'Cutoff must be at least one hour smaller than Duration.', 400);
  const id = `mw-${hex(c.acct, 'mw', 17)}`;
  windowsOf(c.acct, c.region)[id] = { WindowId: id, Name: String(c.p.Name), Schedule: String(c.p.Schedule), Duration: c.p.Duration, Cutoff: c.p.Cutoff, Enabled: true, AllowUnassociatedTargets: c.p.AllowUnassociatedTargets === true, targets: [], tasks: [], executions: [], checkedAt: c.acct.clock, created: c.acct.clock };
  return { WindowId: id };
});

op('ssm', 'get-maintenance-window', 'window-id:s!', 'Datos de una ventana de mantenimiento.', { action: 'ssm:GetMaintenanceWindow', res: (c) => winArn(c, String(c.p.WindowId)) }, (c) => {
  const w = winOf(c);
  return { WindowId: w.WindowId, Name: w.Name, Schedule: w.Schedule, ScheduleTimezone: 'UTC', Duration: w.Duration, Cutoff: w.Cutoff, AllowUnassociatedTargets: w.AllowUnassociatedTargets, Enabled: w.Enabled, CreatedDate: iso(w.created), ModifiedDate: iso(w.created) };
});

op('ssm', 'describe-maintenance-windows', 'filters:f max-results:i', 'Lista las ventanas de mantenimiento.', { paginate: 'WindowIdentities', action: 'ssm:DescribeMaintenanceWindows', res: () => '*' }, (c) => {
  const fl = normTargets(c.p.Filters);
  return { WindowIdentities: Object.values(windowsOf(c.acct, c.region)).filter((w) => fl.every((f) => (f.Key === 'Name' ? f.Values.includes(w.Name) : f.Key === 'Enabled' ? f.Values.includes(String(w.Enabled)) : true))).map((w) => ({ WindowId: w.WindowId, Name: w.Name, Enabled: w.Enabled, Duration: w.Duration, Cutoff: w.Cutoff, Schedule: w.Schedule, ScheduleTimezone: 'UTC' })) };
});

op('ssm', 'update-maintenance-window', 'window-id:s! name:s schedule:s duration:i cutoff:i allow-unassociated-targets:b enabled:b replace:b', 'Cambia el horario, la duración o activa/desactiva la ventana (`--no-enabled`).', { action: 'ssm:UpdateMaintenanceWindow', res: (c) => winArn(c, String(c.p.WindowId)) }, (c) => {
  const w = winOf(c);
  if (c.p.Schedule) {
    checkSchedule(String(c.p.Schedule));
    w.Schedule = String(c.p.Schedule);
  }
  if (c.p.Name) w.Name = c.p.Name;
  if (c.p.Duration !== undefined) w.Duration = c.p.Duration;
  if (c.p.Cutoff !== undefined) w.Cutoff = c.p.Cutoff;
  if (w.Cutoff >= w.Duration) throw new AwsError('ValidationException', 'Cutoff must be at least one hour smaller than Duration.', 400);
  if (c.p.Enabled !== undefined) {
    if (c.p.Enabled && !w.Enabled) w.checkedAt = c.acct.clock;
    w.Enabled = c.p.Enabled;
  }
  if (c.p.AllowUnassociatedTargets !== undefined) w.AllowUnassociatedTargets = c.p.AllowUnassociatedTargets;
  return { WindowId: w.WindowId, Name: w.Name, Schedule: w.Schedule, Duration: w.Duration, Cutoff: w.Cutoff, AllowUnassociatedTargets: w.AllowUnassociatedTargets, Enabled: w.Enabled };
});

op('ssm', 'delete-maintenance-window', 'window-id:s!', 'Borra una ventana con sus destinos y tareas.', { action: 'ssm:DeleteMaintenanceWindow', res: (c) => winArn(c, String(c.p.WindowId)) }, (c) => {
  winOf(c);
  delete windowsOf(c.acct, c.region)[c.p.WindowId];
  return { WindowId: c.p.WindowId };
});

op('ssm', 'register-target-with-maintenance-window', 'window-id:s! resource-type:s! targets:f! owner-information:s name:s description:s client-token:s', 'Dice sobre qué instancias actúa la ventana (por etiqueta o por id).', { action: 'ssm:RegisterTargetWithMaintenanceWindow', res: (c) => winArn(c, String(c.p.WindowId)) }, (c) => {
  const w = winOf(c);
  if (c.p.ResourceType !== 'INSTANCE' && c.p.ResourceType !== 'RESOURCE_GROUP') throw new AwsError('ValidationException', 'ResourceType must be INSTANCE or RESOURCE_GROUP.', 400);
  const id = hex(c.acct, 'mwt', 32).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
  w.targets.push({ WindowTargetId: id, ResourceType: c.p.ResourceType, Targets: normTargets(c.p.Targets) as Targets, Name: c.p.Name });
  return { WindowTargetId: id };
});

op('ssm', 'describe-maintenance-window-targets', 'window-id:s! filters:f', 'Destinos registrados en una ventana.', { action: 'ssm:DescribeMaintenanceWindowTargets', res: (c) => winArn(c, String(c.p.WindowId)) }, (c) => ({
  Targets: winOf(c).targets.map((t) => ({ WindowId: c.p.WindowId, WindowTargetId: t.WindowTargetId, ResourceType: t.ResourceType, Targets: t.Targets, ...(t.Name ? { Name: t.Name } : {}) })),
}));

op('ssm', 'deregister-target-from-maintenance-window', 'window-id:s! window-target-id:s! safe:b', 'Quita un destino de la ventana.', { action: 'ssm:DeregisterTargetFromMaintenanceWindow', res: (c) => winArn(c, String(c.p.WindowId)) }, (c) => {
  const w = winOf(c);
  if (!w.targets.some((t) => t.WindowTargetId === c.p.WindowTargetId)) throw new AwsError('DoesNotExistException', `Target ${c.p.WindowTargetId} does not exist.`, 400);
  w.targets = w.targets.filter((t) => t.WindowTargetId !== c.p.WindowTargetId);
  return { WindowId: w.WindowId, WindowTargetId: c.p.WindowTargetId };
});

const TASK_TYPES = ['RUN_COMMAND', 'AUTOMATION', 'LAMBDA', 'STEP_FUNCTIONS'];

op('ssm', 'register-task-with-maintenance-window', 'window-id:s! targets:f task-arn:s! service-role-arn:s task-type:s! task-parameters:j task-invocation-parameters:j priority:i max-concurrency:s max-errors:s logging-info:j name:s description:s client-token:s', 'Añade una tarea a la ventana: ejecutar un documento (`AWS-RunPatchBaseline`), un runbook, una función Lambda…', { authz: (c) => [{ action: 'ssm:RegisterTaskWithMaintenanceWindow', resource: winArn(c, String(c.p.WindowId)) }, ...(c.p.ServiceRoleArn ? [{ action: 'iam:PassRole', resource: String(c.p.ServiceRoleArn), context: { 'iam:PassedToService': 'ssm.amazonaws.com' } }] : [])] }, (c) => {
  const w = winOf(c);
  if (!TASK_TYPES.includes(c.p.TaskType)) throw new AwsError('ValidationException', `1 validation error detected: Value '${c.p.TaskType}' at 'taskType' failed to satisfy constraint: Member must satisfy enum value set: [${TASK_TYPES.join(', ')}]`, 400);
  if (c.p.ServiceRoleArn) {
    const name = String(c.p.ServiceRoleArn).split('/').pop() ?? '';
    if (!c.acct.iam.roles[name] || !roleTrusts(c.acct, String(c.p.ServiceRoleArn), 'ssm.amazonaws.com')) throw new AwsError('ValidationException', `The service role ${c.p.ServiceRoleArn} is not valid: it must exist and trust ssm.amazonaws.com.`, 400);
  }
  if (c.p.TaskType === 'RUN_COMMAND' && !commandDocs[c.p.TaskArn] && !customCommandDoc.find?.(c.acct, c.region, c.p.TaskArn)) throw new AwsError('ValidationException', `The document ${c.p.TaskArn} is not a Command document.`, 400);
  const targets = normTargets(c.p.Targets);
  for (const t of targets) if (t.Key === 'WindowTargetIds' && !t.Values.every((v) => w.targets.some((x) => x.WindowTargetId === v))) throw new AwsError('DoesNotExistException', 'One of the WindowTargetIds does not exist in this window.', 400);
  if (!targets.length && !w.AllowUnassociatedTargets) throw new AwsError('ValidationException', 'This window does not allow unassociated targets: register targets and use Key=WindowTargetIds.', 400);
  const id = hex(c.acct, 'mwtask', 32).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
  w.tasks.push({ WindowTaskId: id, TaskArn: c.p.TaskArn, TaskType: c.p.TaskType, Targets: targets, TaskInvocationParameters: c.p.TaskInvocationParameters, Priority: c.p.Priority ?? 1, MaxConcurrency: c.p.MaxConcurrency, MaxErrors: c.p.MaxErrors, Name: c.p.Name, ServiceRoleArn: c.p.ServiceRoleArn });
  return { WindowTaskId: id };
});

op('ssm', 'describe-maintenance-window-tasks', 'window-id:s! filters:f', 'Tareas de una ventana.', { action: 'ssm:DescribeMaintenanceWindowTasks', res: (c) => winArn(c, String(c.p.WindowId)) }, (c) => ({
  Tasks: winOf(c).tasks.map((t) => ({ WindowId: c.p.WindowId, WindowTaskId: t.WindowTaskId, TaskArn: t.TaskArn, Type: t.TaskType, Targets: t.Targets, TaskParameters: {}, Priority: t.Priority, ServiceRoleArn: t.ServiceRoleArn ?? `arn:aws:iam::${c.acct.id}:role/aws-service-role/ssm.amazonaws.com/AWSServiceRoleForAmazonSSM`, MaxConcurrency: t.MaxConcurrency ?? '1', MaxErrors: t.MaxErrors ?? '1', ...(t.Name ? { Name: t.Name } : {}) })),
}));

op('ssm', 'deregister-task-from-maintenance-window', 'window-id:s! window-task-id:s!', 'Quita una tarea de la ventana.', { action: 'ssm:DeregisterTaskFromMaintenanceWindow', res: (c) => winArn(c, String(c.p.WindowId)) }, (c) => {
  const w = winOf(c);
  if (!w.tasks.some((t) => t.WindowTaskId === c.p.WindowTaskId)) throw new AwsError('DoesNotExistException', `Task ${c.p.WindowTaskId} does not exist.`, 400);
  w.tasks = w.tasks.filter((t) => t.WindowTaskId !== c.p.WindowTaskId);
  return { WindowId: w.WindowId, WindowTaskId: c.p.WindowTaskId };
});

const execView = (w: SsmWindow, e: SsmWindow['executions'][number]) => ({ WindowId: w.WindowId, WindowExecutionId: e.WindowExecutionId, Status: e.Status, StatusDetails: e.Status, StartTime: iso(e.StartTime), EndTime: iso(e.EndTime) });

op('ssm', 'describe-maintenance-window-executions', 'window-id:s! filters:f', 'Ejecuciones pasadas de una ventana y su resultado.', { action: 'ssm:DescribeMaintenanceWindowExecutions', res: (c) => winArn(c, String(c.p.WindowId)) }, (c) => {
  const w = winOf(c);
  return { WindowExecutions: [...w.executions].reverse().map((e) => execView(w, e)) };
});

op('ssm', 'get-maintenance-window-execution', 'window-execution-id:s!', 'Detalle de una ejecución de la ventana.', { action: 'ssm:GetMaintenanceWindowExecution', res: () => '*' }, (c) => {
  for (const w of Object.values(windowsOf(c.acct, c.region))) {
    const e = w.executions.find((x) => x.WindowExecutionId === c.p.WindowExecutionId);
    if (e) return { WindowExecutionId: e.WindowExecutionId, TaskIds: e.tasks.map((t) => t.TaskExecutionId), Status: e.Status, StatusDetails: e.Status, StartTime: iso(e.StartTime), EndTime: iso(e.EndTime) };
  }
  throw new AwsError('DoesNotExistException', `Maintenance window execution ${c.p.WindowExecutionId} does not exist.`, 400);
});

op('ssm', 'describe-maintenance-window-execution-tasks', 'window-execution-id:s! filters:f', 'Tareas de una ejecución de la ventana.', { action: 'ssm:DescribeMaintenanceWindowExecutionTasks', res: () => '*' }, (c) => {
  for (const w of Object.values(windowsOf(c.acct, c.region))) {
    const e = w.executions.find((x) => x.WindowExecutionId === c.p.WindowExecutionId);
    if (e) return { WindowExecutionTaskIdentities: e.tasks.map((t) => ({ WindowExecutionId: e.WindowExecutionId, TaskExecutionId: t.TaskExecutionId, Status: t.Status, StatusDetails: t.Status, StartTime: iso(e.StartTime), EndTime: iso(e.EndTime), TaskArn: t.TaskArn, TaskType: 'RUN_COMMAND' })) };
  }
  throw new AwsError('DoesNotExistException', `Maintenance window execution ${c.p.WindowExecutionId} does not exist.`, 400);
});

function runWindow(a: Account, region: string, w: SsmWindow, at: number): void {
  const execId = hex(a, 'mwexec', 32).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
  const e: SsmWindow['executions'][number] = { WindowExecutionId: execId, Status: 'SUCCESS', StartTime: at, EndTime: at + 60000, tasks: [] };
  for (const t of [...w.tasks].sort((x, y) => x.Priority - y.Priority)) {
    const ids = new Set<string>();
    const wanted = t.Targets.find((x) => x.Key === 'WindowTargetIds')?.Values ?? [];
    for (const wt of w.targets.filter((x) => wanted.includes(x.WindowTargetId))) for (const i of resolveTargets(a, region, [], wt.Targets)) ids.add(i);
    for (const x of t.Targets.filter((y) => y.Key !== 'WindowTargetIds')) for (const i of resolveTargets(a, region, [], [x])) ids.add(i);
    const r = regional(a, region).ec2.instances;
    const online = [...ids].filter((i) => r[i] && ssmStatus(a, region, r[i], { settled: true }).online);
    const te = { TaskExecutionId: hex(a, 'mwtexec', 32).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5'), TaskArn: t.TaskArn, Status: 'SUCCESS', commandId: undefined as string | undefined };
    if (!online.length) te.Status = 'FAILED';
    else if (t.TaskType === 'RUN_COMMAND') {
      try {
        const params = (t.TaskInvocationParameters as { RunCommand?: { Parameters?: unknown } } | undefined)?.RunCommand?.Parameters;
        const was = a.clock;
        a.clock = Math.max(a.clock, at);
        const res = sendCommand(a, region, t.TaskArn, params, online);
        a.clock = was;
        te.commandId = res.commandId;
        if (res.list.some((x) => x.Status !== 'Success')) te.Status = 'FAILED';
      } catch {
        te.Status = 'FAILED';
      }
    } else if (t.TaskType === 'AUTOMATION') {
      try {
        automationStart(a, region, null, t.TaskArn, ((t.TaskInvocationParameters as { Automation?: { Parameters?: Record<string, unknown> } } | undefined)?.Automation?.Parameters ?? {}) as Record<string, unknown>);
      } catch {
        te.Status = 'FAILED';
      }
    }
    e.tasks.push(te);
    if (te.Status === 'FAILED') e.Status = 'FAILED';
  }
  if (!w.tasks.length) e.Status = 'SUCCESS';
  w.executions.push(e);
  if (w.executions.length > 50) w.executions.shift();
}

// ───────────────────────── asociaciones (State Manager) ─────────────────────────

const assocView = (x: SsmAssociation) => ({
  Name: x.Name,
  AssociationVersion: '1',
  Date: iso(x.created),
  LastUpdateAssociationDate: iso(x.created),
  Status: { Date: iso(x.created), Name: 'Associated', Message: `Associated with ${x.Name}` },
  Overview: { Status: x.status === 'Pending' ? 'Pending' : x.status, DetailedStatus: x.status === 'Pending' ? 'Creating' : x.status === 'Success' ? 'Success' : 'Failed', AssociationStatusAggregatedCount: x.status === 'Pending' ? {} : { [x.status]: 1 } },
  DocumentVersion: '$DEFAULT',
  Parameters: x.Parameters,
  AssociationId: x.AssociationId,
  Targets: x.Targets,
  ...(x.ScheduleExpression ? { ScheduleExpression: x.ScheduleExpression } : {}),
  ...(x.lastExecution ? { LastExecutionDate: iso(x.lastExecution), LastSuccessfulExecutionDate: x.status === 'Success' ? iso(x.lastExecution) : undefined } : {}),
  ...(x.AssociationName ? { AssociationName: x.AssociationName } : {}),
  ApplyOnlyAtCronInterval: false,
});
const assocOut = (x: SsmAssociation) => assocView(x);

function runAssoc(a: Account, region: string, x: SsmAssociation, at: number): void {
  const ids = resolveTargets(a, region, [], x.Targets);
  x.lastExecution = at;
  if (!ids.length) {
    x.status = 'Failed';
    return;
  }
  let ok = true;
  for (const id of ids) {
    try {
      const was = a.clock;
      a.clock = Math.max(a.clock, at);
      const r = sendCommand(a, region, x.Name, x.Parameters, [id]);
      a.clock = was;
      if (r.list.some((c) => c.Status !== 'Success')) ok = false;
    } catch {
      ok = false;
    }
  }
  x.status = ok ? 'Success' : 'Failed';
}

op('ssm', 'create-association', 'name:s! document-version:s instance-id:s parameters:j targets:f schedule-expression:s output-location:j association-name:s automation-target-parameter-name:s max-errors:s max-concurrency:s compliance-severity:s sync-compliance:s apply-only-at-cron-interval:b', 'State Manager: aplica un documento a unas instancias ahora y, si das `--schedule-expression`, de forma periódica.', { action: 'ssm:CreateAssociation', res: () => '*' }, (c) => {
  const name = String(c.p.Name);
  if (!commandDocs[name] && !customCommandDoc.find?.(c.acct, c.region, name)) throw new AwsError('InvalidDocument', `The specified document ${name} does not exist or is not a Command document.`, 400);
  if (c.p.ScheduleExpression) checkSchedule(String(c.p.ScheduleExpression));
  const targets: Targets = c.p.Targets ? normTargets(c.p.Targets) : (c.p.InstanceId ? [{ Key: 'InstanceIds', Values: [c.p.InstanceId] }] : []);
  if (!targets.length) throw new AwsError('InvalidTarget', 'You must specify Targets or InstanceId.', 400);
  const id = hex(c.acct, 'assoc', 32).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
  const params: Record<string, string[]> = Object.fromEntries(Object.entries((c.p.Parameters ?? {}) as Record<string, unknown>).map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : [String(v)]]));
  const x: SsmAssociation = { AssociationId: id, Name: name, Targets: targets, ScheduleExpression: c.p.ScheduleExpression, Parameters: params, AssociationName: c.p.AssociationName, created: c.acct.clock, status: 'Pending', checkedAt: c.acct.clock };
  assocsOf(c.acct, c.region)[id] = x;
  if (!c.p.ApplyOnlyAtCronInterval) runAssoc(c.acct, c.region, x, c.acct.clock);
  return { AssociationDescription: { ...assocOut(x), Overview: { Status: 'Pending', DetailedStatus: 'Creating' } } };
});

op('ssm', 'describe-association', 'name:s instance-id:s association-id:s association-version:s', 'Estado de una asociación (por id o por documento e instancia).', { action: 'ssm:DescribeAssociation', res: () => '*' }, (c) => {
  const list = Object.values(assocsOf(c.acct, c.region));
  const x = c.p.AssociationId ? assocsOf(c.acct, c.region)[c.p.AssociationId] : list.find((y) => y.Name === c.p.Name && y.Targets.some((t) => t.Values.includes(c.p.InstanceId)));
  if (!x) throw new AwsError('AssociationDoesNotExist', 'The specified association does not exist.', 400);
  return { AssociationDescription: assocOut(x) };
});

op('ssm', 'list-associations', 'association-filter-list:f max-results:i', 'Lista las asociaciones.', { paginate: 'Associations', action: 'ssm:ListAssociations', res: () => '*' }, (c) => {
  const fl = toArr<{ key: string; value: string }>(c.p.AssociationFilterList);
  return { Associations: Object.values(assocsOf(c.acct, c.region)).filter((x) => fl.every((f) => (f.key === 'Name' ? x.Name === f.value : f.key === 'AssociationName' ? x.AssociationName === f.value : true))).map((x) => ({ Name: x.Name, AssociationId: x.AssociationId, AssociationVersion: '1', Targets: x.Targets, ...(x.lastExecution ? { LastExecutionDate: iso(x.lastExecution) } : {}), Overview: assocOut(x).Overview, ...(x.ScheduleExpression ? { ScheduleExpression: x.ScheduleExpression } : {}), ...(x.AssociationName ? { AssociationName: x.AssociationName } : {}) })) };
});

op('ssm', 'delete-association', 'name:s instance-id:s association-id:s', 'Borra una asociación.', { action: 'ssm:DeleteAssociation', res: () => '*' }, (c) => {
  const all = assocsOf(c.acct, c.region);
  const x = c.p.AssociationId ? all[c.p.AssociationId] : Object.values(all).find((y) => y.Name === c.p.Name && y.Targets.some((t) => t.Values.includes(c.p.InstanceId)));
  if (!x) throw new AwsError('AssociationDoesNotExist', 'The specified association does not exist.', 400);
  delete all[x.AssociationId];
  return {};
});

op('ssm', 'start-associations-once', 'association-ids:l!', 'Ejecuta ya unas asociaciones, sin esperar a su horario.', { action: 'ssm:StartAssociationsOnce', res: () => '*' }, (c) => {
  for (const id of c.p.AssociationIds as string[]) {
    const x = assocsOf(c.acct, c.region)[id];
    if (!x) throw new AwsError('AssociationDoesNotExist', 'The specified association does not exist.', 400);
    runAssoc(c.acct, c.region, x, c.acct.clock);
  }
  return {};
});

// ───────────────────────── el reloj ─────────────────────────

tickers.push((a) => {
  for (const region of Object.keys(a.regions)) {
    const st = a.regions[region].ssm;
    if (!st) continue;
    for (const w of Object.values(st.windows ?? {})) {
      if (!w.Enabled) {
        w.checkedAt = a.clock;
        continue;
      }
      for (const t of firesBetween(w.Schedule, w.checkedAt, a.clock)) runWindow(a, region, w, t);
      w.checkedAt = a.clock;
    }
    for (const x of Object.values(st.assocs ?? {})) {
      if (!x.ScheduleExpression) continue;
      for (const t of firesBetween(x.ScheduleExpression, Math.max(x.checkedAt, x.lastExecution ?? 0), a.clock).slice(-3)) runAssoc(a, region, x, t);
      x.checkedAt = a.clock;
    }
  }
});

