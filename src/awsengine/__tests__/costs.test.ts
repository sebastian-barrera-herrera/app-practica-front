import { mkEnv } from './helpers';
import { monthlyBurn, totalBurn } from '../pricing';

describe('facturación: Cost Explorer', () => {
  test('gasto por servicio, mes completo y días', async () => {
    const e = mkEnv({ scenario: 'factura' });
    const feb = await e.json('ce get-cost-and-usage --time-period Start=2026-02-01,End=2026-03-01 --granularity MONTHLY --metrics UnblendedCost --group-by Type=DIMENSION,Key=SERVICE');
    expect(feb.ResultsByTime).toHaveLength(1);
    expect(feb.ResultsByTime[0].TimePeriod).toEqual({ Start: '2026-02-01', End: '2026-03-01' });
    const rows = feb.ResultsByTime[0].Groups.map((g: any) => [g.Keys[0], Number(g.Metrics.UnblendedCost.Amount)]);
    const names = rows.map((r: any) => r[0]);
    expect(names).toEqual(expect.arrayContaining(['Amazon Relational Database Service', 'EC2 - Other', 'Amazon Elastic Compute Cloud - Compute', 'Amazon Simple Storage Service', 'AWS Support (Business)']));
    // RDS es lo que más pesa en esta cuenta
    const top = [...rows].sort((x: any, y: any) => y[1] - x[1])[0];
    expect(top[0]).toBe('Amazon Relational Database Service');
    const total = await e.json('ce get-cost-and-usage --time-period Start=2026-02-01,End=2026-03-01 --granularity MONTHLY --metrics UnblendedCost --query "ResultsByTime[0].Total.UnblendedCost.Unit" ');
    expect(total).toBe('USD');
    const daily = await e.json('ce get-cost-and-usage --time-period Start=2026-03-01,End=2026-03-04 --granularity DAILY --metrics UnblendedCost --query "length(ResultsByTime)"');
    expect(daily).toBe(3);
    // el mes en curso está estimado
    expect(await e.json('ce get-cost-and-usage --time-period Start=2026-03-01,End=2026-04-01 --granularity MONTHLY --metrics UnblendedCost --query "ResultsByTime[0].Estimated"')).toBe(true);
    // un mes sin datos
    const none = Number(await e.json('ce get-cost-and-usage --time-period Start=2025-06-01,End=2025-07-01 --granularity MONTHLY --metrics UnblendedCost --query "ResultsByTime[0].Total.UnblendedCost.Amount"'));
    expect(none).toBe(0);
  });

  test('validaciones', async () => {
    const e = mkEnv({ scenario: 'factura' });
    expect((await e.run('ce get-cost-and-usage --time-period Start=2026-03-01,End=2026-02-01 --granularity MONTHLY --metrics UnblendedCost')).stderr).toContain('should be before end date');
    expect((await e.run('ce get-cost-and-usage --time-period Start=2026-02-01,End=2026-03-01 --granularity HOURLY --metrics UnblendedCost')).stderr).toContain('not supported');
    expect((await e.run('ce get-cost-and-usage --time-period Start=2026-02-01,End=2026-03-01 --granularity MONTHLY --metrics Dinero')).stderr).toContain('Invalid metric');
    expect((await e.run('ce get-cost-and-usage --time-period Start=feb,End=mar --granularity MONTHLY --metrics UnblendedCost')).stderr).toContain('YYYY-MM-DD');
  });

  test('filtro por servicio y etiquetas: hay que activarlas antes', async () => {
    const e = mkEnv({ scenario: 'factura' });
    const q = 'ce get-cost-and-usage --time-period Start=2026-02-01,End=2026-03-01 --granularity MONTHLY --metrics UnblendedCost --group-by Type=TAG,Key=Proyecto --query "ResultsByTime[0].Groups[].Keys[0]"';
    // sin activar la etiqueta, todo cae en «sin etiqueta»
    expect(await e.json(q)).toEqual(['Proyecto$']);
    expect(await e.json('ce list-cost-allocation-tags --query "CostAllocationTags[].[TagKey,Status]"')).toEqual([['Entorno', 'Inactive'], ['Name', 'Inactive'], ['Proyecto', 'Inactive']]);
    await e.run('ce update-cost-allocation-tags-status --cost-allocation-tags-status TagKey=Proyecto,Status=Active');
    expect(await e.json(q)).toEqual(['Proyecto$', 'Proyecto$tienda']);
    const only = await e.json('ce get-cost-and-usage --time-period Start=2026-02-01,End=2026-03-01 --granularity MONTHLY --metrics UnblendedCost --filter \'{"Dimensions":{"Key":"SERVICE","Values":["Amazon Relational Database Service"]}}\' --query "ResultsByTime[0].Total.UnblendedCost.Amount"');
    expect(Number(only)).toBeGreaterThan(100);
    const not = await e.json('ce get-cost-and-usage --time-period Start=2026-02-01,End=2026-03-01 --granularity MONTHLY --metrics UnblendedCost --filter \'{"Not":{"Dimensions":{"Key":"SERVICE","Values":["Amazon Relational Database Service"]}}}\' --query "ResultsByTime[0].Total.UnblendedCost.Amount"');
    const all = await e.json('ce get-cost-and-usage --time-period Start=2026-02-01,End=2026-03-01 --granularity MONTHLY --metrics UnblendedCost --query "ResultsByTime[0].Total.UnblendedCost.Amount"');
    expect(Number(only) + Number(not)).toBeCloseTo(Number(all), 5);
  });

  test('la previsión baja al apagar lo que sobra', async () => {
    const e = mkEnv({ scenario: 'factura' });
    const f = async () => Number(await e.json('ce get-cost-forecast --time-period Start=2026-03-15,End=2026-04-01 --metric UNBLENDED_COST --granularity MONTHLY --query Total.Amount'));
    const before = await f();
    expect(before).toBeGreaterThan(300);
    expect((await e.run('ce get-cost-forecast --time-period Start=2026-03-01,End=2026-04-01 --metric UNBLENDED_COST --granularity MONTHLY')).stderr).toContain('today or in the future');
    const nat = await e.json('ec2 describe-nat-gateways --query "NatGateways[0].NatGatewayId"');
    await e.run(`ec2 delete-nat-gateway --nat-gateway-id ${nat}`);
    expect(await f()).toBeLessThan(before);
  });

  test('el pricing identifica los gastos olvidados', () => {
    const e = mkEnv({ scenario: 'factura' });
    const items = monthlyBurn(e.acct);
    const by = (s: string) => items.filter((i) => i.service === s).reduce((n, i) => n + i.monthly, 0);
    expect(items.some((i) => i.resource === 'copia-vieja' && i.note.includes('SIN conectar'))).toBe(true);
    expect(items.some((i) => i.usageType === 'PublicIPv4:IdleAddress')).toBe(true);
    expect(items.some((i) => i.usageType === 'NatGateway-Hours')).toBe(true);
    expect(by('Amazon Relational Database Service')).toBeGreaterThan(by('Amazon Elastic Compute Cloud - Compute'));
    expect(totalBurn(e.acct)).toBeGreaterThan(500);
  });

  test('_check burn solo para el corrector', async () => {
    const e = mkEnv({ scenario: 'factura' });
    expect((await e.run('_check burn --max 10')).code).toBe(252);
    e.io.god = true;
    const r = await e.json('_check burn --max 100000');
    expect(r.Ok).toBe(true);
    expect((await e.json('_check burn --max 10')).Ok).toBe(false);
    expect((await e.json('_check burn --tag Entorno=dev')).Monthly).toBeGreaterThan(0);
  });
});

describe('Organizations', () => {
  test('crear organización, OU, cuenta y moverla', async () => {
    const e = mkEnv();
    expect((await e.run('organizations list-accounts')).stderr).toContain('AWSOrganizationsNotInUseException');
    const o = (await e.json('organizations create-organization --feature-set ALL')).Organization;
    expect(o.Id).toMatch(/^o-[0-9a-f]{10}$/);
    expect(o.MasterAccountId).toBe('123456789012');
    expect((await e.run('organizations create-organization')).stderr).toContain('AlreadyInOrganizationException');
    const root = (await e.json('organizations list-roots')).Roots[0].Id;
    expect(root).toMatch(/^r-/);
    const ou = (await e.json(`organizations create-organizational-unit --parent-id ${root} --name Desarrollo`)).OrganizationalUnit.Id;
    expect(ou).toMatch(/^ou-/);
    expect((await e.run(`organizations create-organizational-unit --parent-id ${root} --name Desarrollo`)).stderr).toContain('Duplicate');
    const req = (await e.json('organizations create-account --email dev@ejemplo.com --account-name dev')).CreateAccountStatus.Id;
    const st = (await e.json(`organizations describe-create-account-status --create-account-request-id ${req}`)).CreateAccountStatus;
    expect(st.State).toBe('SUCCEEDED');
    expect(st.AccountId).toMatch(/^\d{12}$/);
    const dup = (await e.json('organizations create-account --email dev@ejemplo.com --account-name otra')).CreateAccountStatus.Id;
    expect((await e.json(`organizations describe-create-account-status --create-account-request-id ${dup}`)).CreateAccountStatus.FailureReason).toBe('EMAIL_ALREADY_EXISTS');
    await e.run(`organizations move-account --account-id ${st.AccountId} --source-parent-id ${root} --destination-parent-id ${ou}`);
    expect(await e.json(`organizations list-accounts-for-parent --parent-id ${ou} --query "Accounts[].Name"`)).toEqual(['dev']);
    expect((await e.run(`organizations move-account --account-id ${st.AccountId} --source-parent-id ${root} --destination-parent-id ${ou}`)).stderr).toContain('SourceParentNotFoundException');
    expect((await e.run('organizations remove-account-from-organization --account-id 123456789012')).stderr).toContain('ConstraintViolationException');
    expect((await e.run('organizations delete-organization')).stderr).toContain('OrganizationNotEmptyException');
  });

  test('políticas (SCP): crear, aplicar, no quitar la última', async () => {
    const e = mkEnv({ scenario: 'org-demo' });
    const root = (await e.json('organizations list-roots')).Roots[0].Id;
    const scp = '{"Version":"2012-10-17","Statement":[{"Effect":"Deny","Action":"ec2:*","Resource":"*"}]}';
    const p = (await e.json(`organizations create-policy --name sin-ec2 --description x --type SERVICE_CONTROL_POLICY --content '${scp}'`)).Policy.PolicySummary.Id;
    expect((await e.run(`organizations create-policy --name malo --description x --type SERVICE_CONTROL_POLICY --content 'no-json'`)).stderr).toContain('MalformedPolicyDocumentException');
    expect((await e.run(`organizations create-policy --name tags --description x --type TAG_POLICY --content '${scp}'`)).stderr).toContain('PolicyTypeNotEnabledException');
    const acct = (await e.json('organizations list-accounts --query "Accounts[?Name==`desarrollo`].Id | [0]"'));
    await e.run(`organizations attach-policy --policy-id ${p} --target-id ${acct}`);
    expect((await e.run(`organizations attach-policy --policy-id ${p} --target-id ${acct}`)).stderr).toContain('DuplicatePolicyAttachmentException');
    // toda cuenta nueva nace con FullAWSAccess; la SCP nueva se suma a ella
    expect(await e.json(`organizations list-policies-for-target --target-id ${acct} --filter SERVICE_CONTROL_POLICY --query "Policies[].Name"`)).toEqual(['FullAWSAccess', 'sin-ec2']);
    await e.run(`organizations detach-policy --policy-id p-FullAWSAccess --target-id ${acct}`);
    expect((await e.run(`organizations detach-policy --policy-id ${p} --target-id ${acct}`)).stderr).toContain('last service control policy');
    expect((await e.run(`organizations delete-policy --policy-id ${p}`)).stderr).toContain('PolicyInUseException');
    expect(await e.json(`organizations list-policies-for-target --target-id ${root} --filter SERVICE_CONTROL_POLICY --query "Policies[].Name"`)).toEqual(['FullAWSAccess']);
  });
});

describe('API de etiquetas y soporte', () => {
  test('buscar, etiquetar y quitar etiquetas entre servicios', async () => {
    const e = mkEnv({ scenario: 'factura' });
    const all = await e.json('resourcegroupstaggingapi get-resources --tag-filters Key=Proyecto,Values=tienda --query "ResourceTagMappingList[].ResourceARN"');
    expect(all.some((a: string) => a.includes(':instance/'))).toBe(true);
    expect(all.some((a: string) => a === 'arn:aws:s3:::tienda-medios')).toBe(true);
    expect(all.some((a: string) => a.includes(':db:tienda-prod'))).toBe(true);
    const onlyDev = await e.json('resourcegroupstaggingapi get-resources --tag-filters Key=Entorno,Values=dev --resource-type-filters rds:db --query "ResourceTagMappingList[].ResourceARN"');
    expect(onlyDev).toEqual(['arn:aws:rds:us-east-1:123456789012:db:tienda-dev']);
    // el servidor olvidado no tiene etiquetas: no aparece
    const keys = await e.json('resourcegroupstaggingapi get-tag-keys --query TagKeys');
    expect(keys).toEqual(['Entorno', 'Name', 'Proyecto']);
    const id = await e.json('ec2 describe-instances --filters Name=tag:Name,Values=batch-olvidado --query "Reservations[0].Instances[0].InstanceId"');
    const arn = `arn:aws:ec2:us-east-1:123456789012:instance/${id}`;
    const r = await e.json(`resourcegroupstaggingapi tag-resources --resource-arn-list ${arn} arn:aws:s3:::nada --tags Proyecto=tienda,Entorno=dev`);
    expect(Object.keys(r.FailedResourcesMap)).toEqual(['arn:aws:s3:::nada']);
    expect(await e.json(`ec2 describe-instances --instance-ids ${id} --query "Reservations[0].Instances[0].Tags[?Key=='Proyecto'].Value"`)).toEqual(['tienda']);
    await e.run(`resourcegroupstaggingapi untag-resources --resource-arn-list ${arn} --tag-keys Entorno`);
    expect(await e.json('resourcegroupstaggingapi get-tag-values --key Entorno --query TagValues')).toEqual(['dev', 'prod']);
  });

  test('Trusted Advisor requiere plan Business', async () => {
    const e = mkEnv();
    const bad = await e.run('support describe-trusted-advisor-checks --language en');
    expect(bad.stderr).toContain('SubscriptionRequiredException');
    const s = mkEnv({ scenario: 'soporte' });
    const checks = await s.json('support describe-trusted-advisor-checks --language en --query "checks[].[id,category]"');
    expect(checks.length).toBeGreaterThanOrEqual(6);
    const sg = await s.json('support describe-trusted-advisor-check-result --check-id HCP4007jGY --query "result.[status,resourcesSummary.resourcesFlagged]"');
    expect(sg).toEqual(['error', 1]);
    expect(await s.json('support describe-trusted-advisor-check-result --check-id 7DAFEmoDos --query result.status')).toBe('error');
    expect(await s.json('support describe-trusted-advisor-check-result --check-id Pfx0RwqBli --query "result.flaggedResources[0].resourceId"')).toBe('datos-publicos');
    expect(await s.json('support describe-trusted-advisor-check-result --check-id Z4AUBRNSmz --query "result.resourcesSummary.resourcesFlagged"')).toBe(1);
    expect(Number(await s.json('support describe-trusted-advisor-check-result --check-id Qch7DwouX1 --query "result.categorySpecificSummary.costOptimizing.estimatedMonthlySavings"'))).toBeGreaterThan(100);
    // arreglar el grupo de seguridad hace que el chequeo pase
    const gid = await s.json('ec2 describe-security-groups --filters Name=group-name,Values=ssh-abierto --query "SecurityGroups[0].GroupId"');
    await s.run(`ec2 revoke-security-group-ingress --group-id ${gid} --protocol tcp --port 22 --cidr 0.0.0.0/0`);
    expect(await s.json('support describe-trusted-advisor-check-result --check-id HCP4007jGY --query result.status')).toBe('ok');
  });
});
