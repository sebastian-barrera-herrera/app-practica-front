/** Servicios pequeños: Budgets, CloudWatch (alarmas), SNS y los parámetros públicos de SSM. */
import { regional } from '../account';
import { IMAGES, imageId, instanceType } from '../catalog';
import { AwsError, op } from '../registry';
import type { Account, Alarm, Budget } from '../types';
import { iso, mkArn } from '../util';
import { refreshEc2 } from './ec2';
import { liveAlarmState } from './metrics';

// ───────────────────────── coste estimado ─────────────────────────

/** Gasto estimado del mes: horas de instancia encendidas × precio orientativo. */
export function estimatedCharges(a: Account): number {
  let total = 0;
  for (const reg of Object.keys(a.regions)) {
    for (const i of Object.values(a.regions[reg].ec2.instances)) {
      const hours = Math.max(0, (Math.min(a.clock, i.state === 'running' || i.state === 'pending' ? a.clock : i.stateAt) - Date.parse(i.LaunchTime)) / 3600000);
      total += hours * (instanceType(i.InstanceType)?.price ?? 0.05);
    }
  }
  return Math.round(total * 100) / 100;
}

// ───────────────────────── Budgets ─────────────────────────

const budgetAccount = (a: Account, id: string) => {
  if (id !== a.id) throw new AwsError('AccessDeniedException', `You don't have permission to access account ${id}.`, 403);
};

const budgetView = (a: Account, b: Budget) => ({
  BudgetName: b.BudgetName,
  BudgetLimit: b.BudgetLimit,
  CostFilters: {},
  CostTypes: { IncludeTax: true, IncludeSubscription: true, UseBlended: false, IncludeRefund: false, IncludeCredit: false, IncludeUpfront: true, IncludeRecurring: true, IncludeOtherSubscription: true, IncludeSupport: true, IncludeDiscount: true, UseAmortized: false },
  TimeUnit: b.TimeUnit,
  TimePeriod: { Start: iso(Date.UTC(2026, 2, 1)), End: iso(Date.UTC(2087, 5, 15)) },
  CalculatedSpend: { ActualSpend: { Amount: estimatedCharges(a).toFixed(1), Unit: 'USD' }, ForecastedSpend: { Amount: (estimatedCharges(a) * 2).toFixed(1), Unit: 'USD' } },
  BudgetType: b.BudgetType,
  LastUpdatedTime: iso(a.clock),
});

op('budgets', 'create-budget', 'account-id:s! budget:j! notifications-with-subscribers:f', 'Crea un presupuesto con avisos por correo o SNS.', { global: true, res: (c) => `arn:aws:budgets::${c.p.AccountId}:budget/${c.p.Budget?.BudgetName ?? '*'}`, action: 'budgets:ModifyBudget' }, (c) => {
  budgetAccount(c.acct, c.p.AccountId);
  const b = c.p.Budget;
  if (!b?.BudgetName) throw new AwsError('InvalidParameterException', 'BudgetName is required.');
  if (c.acct.budgets[b.BudgetName]) throw new AwsError('DuplicateRecordException', `Error creating budget: ${b.BudgetName} - the budget already exists.`);
  if (!b.BudgetLimit?.Amount || Number.isNaN(Number(b.BudgetLimit.Amount))) throw new AwsError('InvalidParameterException', 'BudgetLimit is required for this budget type.');
  if (!['MONTHLY', 'QUARTERLY', 'ANNUALLY', 'DAILY'].includes(b.TimeUnit)) throw new AwsError('InvalidParameterException', 'TimeUnit must be one of MONTHLY, QUARTERLY, ANNUALLY, DAILY.');
  c.acct.budgets[b.BudgetName] = { BudgetName: b.BudgetName, BudgetLimit: { Amount: String(b.BudgetLimit.Amount), Unit: b.BudgetLimit.Unit ?? 'USD' }, TimeUnit: b.TimeUnit, BudgetType: b.BudgetType ?? 'COST', notifications: c.p.NotificationsWithSubscribers ?? [] };
  return {};
});
op('budgets', 'describe-budgets', 'account-id:s!', 'Lista los presupuestos de la cuenta.', { global: true, action: 'budgets:ViewBudget', res: (c) => `arn:aws:budgets::${c.p.AccountId}:budget/*` }, (c) => {
  budgetAccount(c.acct, c.p.AccountId);
  return { Budgets: Object.values(c.acct.budgets).map((b) => budgetView(c.acct, b)) };
});
op('budgets', 'describe-budget', 'account-id:s! budget-name:s!', 'Datos de un presupuesto.', { global: true, action: 'budgets:ViewBudget', res: (c) => `arn:aws:budgets::${c.p.AccountId}:budget/${c.p.BudgetName}` }, (c) => {
  budgetAccount(c.acct, c.p.AccountId);
  const b = c.acct.budgets[c.p.BudgetName];
  if (!b) throw new AwsError('NotFoundException', `Failed to call DescribeBudget for budget: ${c.p.BudgetName} - budget not found`, 404);
  return { Budget: budgetView(c.acct, b) };
});
op('budgets', 'delete-budget', 'account-id:s! budget-name:s!', 'Borra un presupuesto.', { global: true, action: 'budgets:ModifyBudget', res: (c) => `arn:aws:budgets::${c.p.AccountId}:budget/${c.p.BudgetName}` }, (c) => {
  budgetAccount(c.acct, c.p.AccountId);
  if (!c.acct.budgets[c.p.BudgetName]) throw new AwsError('NotFoundException', `Failed to call DeleteBudget for budget: ${c.p.BudgetName} - budget not found`, 404);
  delete c.acct.budgets[c.p.BudgetName];
  return {};
});
op('budgets', 'describe-notifications-for-budget', 'account-id:s! budget-name:s!', 'Avisos configurados en un presupuesto.', { global: true, action: 'budgets:ViewBudget', res: (c) => `arn:aws:budgets::${c.p.AccountId}:budget/${c.p.BudgetName}` }, (c) => {
  budgetAccount(c.acct, c.p.AccountId);
  const b = c.acct.budgets[c.p.BudgetName];
  if (!b) throw new AwsError('NotFoundException', `Failed to call DescribeNotificationsForBudget for budget: ${c.p.BudgetName} - budget not found`, 404);
  return { Notifications: b.notifications.map((n: any) => n.Notification) };
});

// ───────────────────────── CloudWatch ─────────────────────────

const alarmArn = (c: { acct: Account; region: string }, name: string) => mkArn('cloudwatch', c.region, c.acct.id, `alarm:${name}`);

function alarmState(a: Account, region: string, al: Alarm): Alarm['StateValue'] {
  if (al.Namespace === 'AWS/Billing' && al.MetricName === 'EstimatedCharges') {
    if (region !== 'us-east-1') return 'INSUFFICIENT_DATA';
    return estimatedCharges(a) > al.Threshold ? 'ALARM' : 'OK';
  }
  return liveAlarmState(a, region, al) ?? al.StateValue;
}

const alarmView = (c: { acct: Account; region: string }, al: Alarm) => {
  const st = alarmState(c.acct, c.region, al);
  return {
    AlarmName: al.AlarmName,
    AlarmArn: alarmArn(c, al.AlarmName),
    ...(al.AlarmDescription ? { AlarmDescription: al.AlarmDescription } : {}),
    AlarmConfigurationUpdatedTimestamp: iso(c.acct.clock),
    ActionsEnabled: true,
    OKActions: [],
    AlarmActions: al.AlarmActions,
    InsufficientDataActions: [],
    StateValue: st,
    StateReason: st === 'INSUFFICIENT_DATA' ? 'Unchecked: Initial alarm creation' : st === 'OK' ? 'Threshold Crossed: 1 datapoint was not greater than the threshold.' : 'Threshold Crossed: 1 datapoint was greater than the threshold.',
    StateUpdatedTimestamp: iso(c.acct.clock),
    MetricName: al.MetricName,
    Namespace: al.Namespace,
    Statistic: al.Statistic,
    Dimensions: al.Dimensions,
    Period: al.Period,
    EvaluationPeriods: al.EvaluationPeriods,
    Threshold: al.Threshold,
    ComparisonOperator: al.ComparisonOperator,
    ...(al.TreatMissingData ? { TreatMissingData: al.TreatMissingData } : {}),
  };
};

const COMPARATORS = ['GreaterThanOrEqualToThreshold', 'GreaterThanThreshold', 'LessThanThreshold', 'LessThanOrEqualToThreshold'];

op('cloudwatch', 'put-metric-alarm', 'alarm-name:s! alarm-description:s metric-name:s! namespace:s! statistic:s period:i! evaluation-periods:i! threshold:n! comparison-operator:s! dimensions:f alarm-actions:l treat-missing-data:s', 'Crea o actualiza una alarma sobre una métrica.', { res: (c) => alarmArn(c, c.p.AlarmName) }, (c) => {
  if (!COMPARATORS.includes(c.p.ComparisonOperator)) throw new AwsError('ValidationError', `1 validation error detected: Value '${c.p.ComparisonOperator}' at 'comparisonOperator' failed to satisfy constraint: Member must satisfy enum value set: [${COMPARATORS.join(', ')}]`);
  const r = regional(c.acct, c.region);
  r.alarms[c.p.AlarmName] = {
    AlarmName: c.p.AlarmName,
    Namespace: c.p.Namespace,
    MetricName: c.p.MetricName,
    Statistic: c.p.Statistic ?? 'Average',
    Period: c.p.Period,
    EvaluationPeriods: c.p.EvaluationPeriods,
    Threshold: c.p.Threshold,
    ComparisonOperator: c.p.ComparisonOperator,
    AlarmActions: c.p.AlarmActions ?? [],
    Dimensions: c.p.Dimensions ?? [],
    AlarmDescription: c.p.AlarmDescription,
    TreatMissingData: c.p.TreatMissingData,
    StateValue: 'INSUFFICIENT_DATA',
  };
  return undefined;
});
op('cloudwatch', 'describe-alarms', 'alarm-names:l alarm-name-prefix:s state-value:s', 'Lista las alarmas de la región.', { paginate: 'MetricAlarms', res: () => '*' }, (c) => {
  const r = regional(c.acct, c.region);
  const list = Object.values(r.alarms).filter((al) => (!c.p.AlarmNames || c.p.AlarmNames.includes(al.AlarmName)) && (!c.p.AlarmNamePrefix || al.AlarmName.startsWith(c.p.AlarmNamePrefix)) && (!c.p.StateValue || alarmState(c.acct, c.region, al) === c.p.StateValue));
  return { CompositeAlarms: [], MetricAlarms: list.map((al) => alarmView(c, al)) };
});
op('cloudwatch', 'delete-alarms', 'alarm-names:l!', 'Borra alarmas.', { res: (c) => (c.p.AlarmNames as string[]).map((n) => alarmArn(c, n)) }, (c) => {
  const r = regional(c.acct, c.region);
  for (const n of c.p.AlarmNames as string[]) delete r.alarms[n];
  return undefined;
});
op('cloudwatch', 'set-alarm-state', 'alarm-name:s! state-value:s! state-reason:s!', 'Fuerza el estado de una alarma (para probar las acciones).', { res: (c) => alarmArn(c, c.p.AlarmName) }, (c) => {
  const al = regional(c.acct, c.region).alarms[c.p.AlarmName];
  if (!al) throw new AwsError('ResourceNotFound', `Alarm ${c.p.AlarmName} not found`, 404);
  if (!['OK', 'ALARM', 'INSUFFICIENT_DATA'].includes(c.p.StateValue)) throw new AwsError('ValidationError', `1 validation error detected: Value '${c.p.StateValue}' at 'stateValue' failed to satisfy constraint: Member must satisfy enum value set: [INSUFFICIENT_DATA, ALARM, OK]`);
  al.StateValue = c.p.StateValue;
  return undefined;
});

// ───────────────────────── SSM (parámetros públicos de AMI) ─────────────────────────

op('ssm', 'get-parameter', 'name:s! with-decryption:b', 'Lee un parámetro (aquí, los públicos de AWS con el último ID de AMI).', { res: (c) => mkArn('ssm', c.region, c.acct.id, `parameter${String(c.p.Name).startsWith('/') ? '' : '/'}${c.p.Name}`) }, (c) => {
  const name = c.p.Name as string;
  const img = IMAGES.find((i) => i.ssm === name);
  if (!img) throw new AwsError('ParameterNotFound', '', 400);
  refreshEc2(c.acct, c.region);
  return { Parameter: { Name: name, Type: 'String', Value: imageId(c.region, img.key), Version: 12, LastModifiedDate: img.created, ARN: mkArn('ssm', c.region, '', `parameter${name}`), DataType: 'aws:ec2:image' } };
});
