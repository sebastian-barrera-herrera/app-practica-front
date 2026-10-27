/** Servicios pequeños: Budgets (las alarmas de CloudWatch están en `cwalarms.ts`, los parámetros de SSM en `ssmparams.ts`). */
import { instanceType } from '../catalog';
import { AwsError, op } from '../registry';
import type { Account, Budget } from '../types';
import { iso } from '../util';

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
