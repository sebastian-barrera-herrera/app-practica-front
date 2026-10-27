import { imageId } from '../catalog';
import { mkEnv, type TestEnv } from './helpers';

const ZIP = 'PK\x03\x04@@ZIP@@';
const zip = (files: Record<string, string>) => ZIP + JSON.stringify(Object.entries(files).map(([path, content]) => ({ path, kind: 'file', mode: 0o644, mtime: 0, uid: 'a', gid: 'a', content })));
const TRUST = (svc: string) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: svc }, Action: 'sts:AssumeRole' }] });

const minute = (e: TestEnv, n = 1) => {
  e.acct.clock += n * 60000;
};
const stats = async (e: TestEnv, metric: string, stat: string, extra = '') => {
  const end = new Date(e.acct.clock + 120000).toISOString();
  const start = new Date(e.acct.clock - 3 * 3600000).toISOString();
  return (await e.json(`cloudwatch get-metric-statistics --namespace App/Tienda --metric-name ${metric} --start-time ${start} --end-time ${end} --period 3600 --statistics ${stat} ${extra}`)).Datapoints;
};
const sum = (dp: { Sum?: number }[]) => dp.reduce((n, x) => n + (x.Sum ?? 0), 0);

describe('CloudWatch: métricas propias', () => {
  test('put-metric-data y estadísticas', async () => {
    const e = mkEnv();
    expect((await e.run('cloudwatch put-metric-data --namespace App/Tienda --metric-name Pedidos --value 3 --unit Count')).code).toBe(0);
    await e.run('cloudwatch put-metric-data --namespace App/Tienda --metric-name Pedidos --value 5 --unit Count');
    await e.run('cloudwatch put-metric-data --namespace App/Tienda --metric-name Pedidos --statistic-values Sum=10,Minimum=1,Maximum=4,SampleCount=4 --unit Count');
    await e.run(`cloudwatch put-metric-data --namespace App/Tienda --metric-data '[{"MetricName":"Latencia","Values":[10,20,30],"Counts":[1,1,2],"Unit":"Milliseconds"}]'`);
    const dp = await stats(e, 'Pedidos', 'Sum');
    expect(sum(dp)).toBe(18);
    expect(dp[0].Unit).toBe('Count');
    expect(sum(await stats(e, 'Pedidos', 'SampleCount') as never)).toBe(0);
    const n = (await stats(e, 'Pedidos', 'SampleCount')).reduce((x: number, y: { SampleCount: number }) => x + y.SampleCount, 0);
    expect(n).toBe(6);
    expect((await stats(e, 'Pedidos', 'Maximum'))[0].Maximum).toBe(5);
    expect((await stats(e, 'Latencia', 'Average'))[0].Average).toBe(22.5);
    const p = await stats(e, 'Latencia', 'Average', '').then(() => e.json(`cloudwatch get-metric-statistics --namespace App/Tienda --metric-name Latencia --start-time ${new Date(e.acct.clock - 3600000).toISOString()} --end-time ${new Date(e.acct.clock + 60000).toISOString()} --period 3600 --extended-statistics p90`));
    expect(p.Datapoints[0].ExtendedStatistics.p90).toBe(30);
  });

  test('validaciones de put-metric-data', async () => {
    const e = mkEnv();
    expect((await e.run('cloudwatch put-metric-data --namespace AWS/Mia --metric-name X --value 1')).stderr).toContain('The value AWS/Mia for parameter Namespace is invalid');
    expect((await e.run(`cloudwatch put-metric-data --namespace App --metric-data '[{"MetricName":"X"}]'`)).stderr).toContain('At least one of the parameters');
    expect((await e.run('cloudwatch put-metric-data --namespace App --metric-name X --value 1 --unit Furlongs')).stderr).toContain('must be a valid unit');
    const old = new Date(e.acct.clock - 20 * 86400000).toISOString();
    expect((await e.run(`cloudwatch put-metric-data --namespace App --metric-name X --value 1 --timestamp ${old}`)).stderr).toContain('within the past two weeks');
    expect((await e.run('cloudwatch put-metric-data --namespace App --metric-name X --value abc')).stderr).toContain('invalid float value');
  });

  test('list-metrics muestra las métricas propias y filtra por dimensión', async () => {
    const e = mkEnv();
    await e.run('cloudwatch put-metric-data --namespace App/Tienda --metric-name Pedidos --value 1 --dimensions Tienda=Madrid');
    await e.run('cloudwatch put-metric-data --namespace App/Tienda --metric-name Pedidos --value 1 --dimensions Tienda=Lima');
    const all = await e.json('cloudwatch list-metrics --namespace App/Tienda');
    expect(all.Metrics).toHaveLength(2);
    const some = await e.json('cloudwatch list-metrics --namespace App/Tienda --dimensions Name=Tienda,Value=Lima');
    expect(some.Metrics).toHaveLength(1);
    // las dimensiones identifican la métrica: sin ellas no hay datos
    const end = new Date(e.acct.clock + 60000).toISOString();
    const start = new Date(e.acct.clock - 600000).toISOString();
    const none = await e.json(`cloudwatch get-metric-statistics --namespace App/Tienda --metric-name Pedidos --start-time ${start} --end-time ${end} --period 60 --statistics Sum`);
    expect(none.Datapoints).toEqual([]);
  });

  test('get-metric-data con fórmulas', async () => {
    const e = mkEnv();
    const ns = 'App/Tienda';
    for (let i = 0; i < 4; i++) {
      await e.run(`cloudwatch put-metric-data --namespace ${ns} --metric-data '[{"MetricName":"Errores","Value":${i + 1}},{"MetricName":"Peticiones","Value":100}]'`);
      minute(e);
    }
    const start = new Date(e.acct.clock - 10 * 60000).toISOString();
    const end = new Date(e.acct.clock + 60000).toISOString();
    const q = (extra: unknown[]) =>
      JSON.stringify([
        { Id: 'err', MetricStat: { Metric: { Namespace: ns, MetricName: 'Errores' }, Period: 60, Stat: 'Sum' }, ReturnData: false },
        { Id: 'req', MetricStat: { Metric: { Namespace: ns, MetricName: 'Peticiones' }, Period: 60, Stat: 'Sum' }, ReturnData: false },
        ...extra,
      ]);
    const r = await e.json(`cloudwatch get-metric-data --start-time ${start} --end-time ${end} --scan-by TimestampAscending --metric-data-queries '${q([{ Id: 'tasa', Expression: 'err/req*100', Label: 'Tasa de error' }])}'`);
    expect(r.MetricDataResults).toHaveLength(1);
    expect(r.MetricDataResults[0].Label).toBe('Tasa de error');
    expect(r.MetricDataResults[0].Values).toEqual([1, 2, 3, 4]);
    const d = await e.json(`cloudwatch get-metric-data --start-time ${start} --end-time ${end} --metric-data-queries '${q([{ Id: 't', Expression: 'SUM(err)' }])}'`);
    expect(d.MetricDataResults[0].Values.every((v: number) => v === 10)).toBe(true);
    const total = await e.json(`cloudwatch get-metric-data --start-time ${start} --end-time ${end} --scan-by TimestampAscending --metric-data-queries '${q([{ Id: 'tot', Expression: 'SUM(METRICS())' }])}'`);
    expect(total.MetricDataResults[0].Values).toEqual([101, 102, 103, 104]);
    const rate = await e.json(`cloudwatch get-metric-data --start-time ${start} --end-time ${end} --scan-by TimestampAscending --metric-data-queries '${q([{ Id: 'dif', Expression: 'DIFF(err)' }])}'`);
    expect(rate.MetricDataResults[0].Values).toEqual([1, 1, 1]);
    const asc = await e.json(`cloudwatch get-metric-data --start-time ${start} --end-time ${end} --metric-data-queries '${q([{ Id: 'x', Expression: 'err' }])}'`);
    expect(asc.MetricDataResults[0].Values).toEqual([4, 3, 2, 1]);
    expect((await e.run(`cloudwatch get-metric-data --start-time ${start} --end-time ${end} --metric-data-queries '${q([{ Id: 'x', Expression: 'nada + 1' }])}'`)).stderr).toContain('does not match any query Id');
    expect((await e.run(`cloudwatch get-metric-data --start-time ${start} --end-time ${end} --metric-data-queries '${q([{ Id: 'x', Expression: 'err +' }])}'`)).stderr).toContain('ValidationError');
  });
});

describe('CloudWatch: alarmas', () => {
  const alarm = (extra = '') => `cloudwatch put-metric-alarm --alarm-name altas-pedidos --namespace App/Tienda --metric-name Pedidos --statistic Sum --period 60 --evaluation-periods 1 --threshold 10 --comparison-operator GreaterThanThreshold ${extra}`;

  test('estados, motivo e historial', async () => {
    const e = mkEnv();
    await e.run(alarm());
    let a = (await e.json('cloudwatch describe-alarms --alarm-names altas-pedidos')).MetricAlarms[0];
    expect(a.StateValue).toBe('INSUFFICIENT_DATA');
    expect(a.StateReason).toBe('Unchecked: Initial alarm creation');
    expect(a.ActionsEnabled).toBe(true);
    await e.run('cloudwatch put-metric-data --namespace App/Tienda --metric-name Pedidos --value 25');
    a = (await e.json('cloudwatch describe-alarms --alarm-names altas-pedidos')).MetricAlarms[0];
    expect(a.StateValue).toBe('ALARM');
    expect(a.StateReason).toMatch(/^Threshold Crossed: 1 out of the last 1 datapoints \[25\.0 \(14\/03\/26 10:0\d:00\)\] was greater than the threshold \(10\.0\) \(minimum 1 datapoint for OK -> ALARM transition\)\.$/);
    expect(JSON.parse(a.StateReasonData).recentDatapoints).toEqual([25]);
    minute(e, 2);
    await e.run('cloudwatch put-metric-data --namespace App/Tienda --metric-name Pedidos --value 2');
    a = (await e.json('cloudwatch describe-alarms --alarm-names altas-pedidos')).MetricAlarms[0];
    expect(a.StateValue).toBe('OK');
    expect(a.StateReason).toContain('was not greater than the threshold');
    const h = (await e.json('cloudwatch describe-alarm-history --alarm-name altas-pedidos --history-item-type StateUpdate')).AlarmHistoryItems;
    // sin datos nuevos la alarma pasó a INSUFFICIENT_DATA antes de volver a OK
    expect(h.map((x: { HistorySummary: string }) => x.HistorySummary)).toEqual(['Alarm updated from INSUFFICIENT_DATA to OK', 'Alarm updated from ALARM to INSUFFICIENT_DATA', 'Alarm updated from INSUFFICIENT_DATA to ALARM']);
    const all = (await e.json('cloudwatch describe-alarm-history --alarm-name altas-pedidos --scan-by TimestampAscending')).AlarmHistoryItems;
    expect(all[0].HistoryItemType).toBe('ConfigurationUpdate');
    expect(all[0].HistorySummary).toBe('Alarm "altas-pedidos" created');
  });

  test('DatapointsToAlarm, TreatMissingData y validaciones', async () => {
    const e = mkEnv();
    await e.run(alarm('--evaluation-periods 3 --datapoints-to-alarm 2'));
    // dos de tres periodos en rojo
    await e.run('cloudwatch put-metric-data --namespace App/Tienda --metric-name Pedidos --value 50');
    expect((await e.json('cloudwatch describe-alarms --alarm-names altas-pedidos')).MetricAlarms[0].StateValue).toBe('OK');
    minute(e);
    await e.run('cloudwatch put-metric-data --namespace App/Tienda --metric-name Pedidos --value 50');
    expect((await e.json('cloudwatch describe-alarms --alarm-names altas-pedidos')).MetricAlarms[0].StateValue).toBe('ALARM');
    // los datos que faltan
    await e.run('cloudwatch put-metric-alarm --alarm-name sin-datos --namespace App/Tienda --metric-name Latido --statistic Sum --period 60 --evaluation-periods 1 --threshold 1 --comparison-operator LessThanThreshold --treat-missing-data breaching');
    expect((await e.json('cloudwatch describe-alarms --alarm-names sin-datos')).MetricAlarms[0].StateValue).toBe('ALARM');
    await e.run('cloudwatch put-metric-alarm --alarm-name sin-datos --namespace App/Tienda --metric-name Latido --statistic Sum --period 60 --evaluation-periods 1 --threshold 1 --comparison-operator LessThanThreshold --treat-missing-data notBreaching');
    expect((await e.json('cloudwatch describe-alarms --alarm-names sin-datos')).MetricAlarms[0].StateValue).toBe('OK');
    expect((await e.run(alarm('--datapoints-to-alarm 5')).then((r) => r.stderr))).toContain('DatapointsToAlarm must be between 1 and EvaluationPeriods');
    expect((await e.run('cloudwatch put-metric-alarm --alarm-name x --namespace A --metric-name M --period 60 --evaluation-periods 1 --threshold 1 --comparison-operator GreaterThanThreshold')).stderr).toContain('Exactly one of Statistic or ExtendedStatistic');
    expect((await e.run(alarm('--comparison-operator Mayor')).then((r) => r.stderr))).toContain('comparisonOperator');
  });

  test('acciones: SNS al pasar a ALARM y a OK, y desactivarlas', async () => {
    const e = mkEnv();
    const topic = (await e.json('sns create-topic --name avisos')).TopicArn;
    await e.run(alarm(`--alarm-actions ${topic} --ok-actions ${topic} --alarm-description "Demasiados pedidos"`));
    const msgs = () => e.acct.regions['us-east-1'].sns[topic].messages;
    await e.run('cloudwatch put-metric-data --namespace App/Tienda --metric-name Pedidos --value 30');
    await e.run('sts get-caller-identity');
    expect(msgs()).toHaveLength(1);
    const body = JSON.parse(msgs()[0]);
    expect(body).toMatchObject({ AlarmName: 'altas-pedidos', NewStateValue: 'ALARM', OldStateValue: 'INSUFFICIENT_DATA', AlarmDescription: 'Demasiados pedidos', Region: 'US East (N. Virginia)' });
    expect(body.Trigger).toMatchObject({ MetricName: 'Pedidos', Namespace: 'App/Tienda', Threshold: 10, EvaluationPeriods: 1 });
    minute(e, 2);
    await e.run('cloudwatch put-metric-data --namespace App/Tienda --metric-name Pedidos --value 1');
    await e.run('sts get-caller-identity');
    expect(msgs().map((m) => JSON.parse(m).NewStateValue)).toEqual(['ALARM', 'OK']);
    const acts = (await e.json('cloudwatch describe-alarm-history --alarm-name altas-pedidos --history-item-type Action')).AlarmHistoryItems;
    expect(acts[0].HistorySummary).toBe(`Successfully executed action ${topic}`);
    // set-alarm-state dispara las acciones; con las acciones desactivadas no
    await e.run('cloudwatch set-alarm-state --alarm-name altas-pedidos --state-value ALARM --state-reason prueba');
    expect(msgs()).toHaveLength(3);
    await e.run('cloudwatch disable-alarm-actions --alarm-names altas-pedidos');
    await e.run('cloudwatch set-alarm-state --alarm-name altas-pedidos --state-value OK --state-reason prueba');
    expect(msgs()).toHaveLength(3);
    expect((await e.json('cloudwatch describe-alarms --alarm-names altas-pedidos')).MetricAlarms[0].ActionsEnabled).toBe(false);
    // acción hacia un tema que no existe
    await e.run(alarm(`--alarm-actions arn:aws:sns:us-east-1:123456789012:fantasma`));
    await e.run('cloudwatch set-alarm-state --alarm-name altas-pedidos --state-value ALARM --state-reason otra');
    const f = (await e.json('cloudwatch describe-alarm-history --alarm-name altas-pedidos --history-item-type Action --max-records 1')).AlarmHistoryItems[0];
    expect(f.HistorySummary).toContain('Failed to execute action');
  });

  test('una alarma puede parar la instancia', async () => {
    const e = mkEnv();
    const id = (await e.json(`ec2 run-instances --image-id ${imageId('us-east-1', 'al2023-x86')} --instance-type t3.micro --query Instances[0].InstanceId`)) as string;
    e.acct.clock += 120000;
    await e.run(`cloudwatch put-metric-alarm --alarm-name disco-lleno --namespace App/Host --metric-name DiscoUsado --dimensions Name=InstanceId,Value=${id} --statistic Maximum --period 60 --evaluation-periods 1 --threshold 90 --comparison-operator GreaterThanThreshold --alarm-actions arn:aws:automate:us-east-1:ec2:stop`);
    expect((await e.json(`ec2 describe-instances --instance-ids ${id} --query Reservations[0].Instances[0].State.Name`))).toBe('running');
    await e.run(`cloudwatch put-metric-data --namespace App/Host --metric-name DiscoUsado --dimensions InstanceId=${id} --value 95 --unit Percent`);
    await e.run('sts get-caller-identity');
    const st = await e.json(`ec2 describe-instances --instance-ids ${id} --query Reservations[0].Instances[0].State.Name`);
    expect(['stopping', 'stopped']).toContain(st);
    const act = (await e.json('cloudwatch describe-alarm-history --alarm-name disco-lleno --history-item-type Action')).AlarmHistoryItems[0];
    expect(act.HistorySummary).toBe('Successfully executed action arn:aws:automate:us-east-1:ec2:stop');
  });

  test('alarma compuesta: avisa solo cuando se cumplen las dos', async () => {
    const e = mkEnv();
    const topic = (await e.json('sns create-topic --name guardia')).TopicArn;
    await e.run(alarm());
    await e.run('cloudwatch put-metric-alarm --alarm-name latencia-alta --namespace App/Tienda --metric-name Latencia --statistic Maximum --period 60 --evaluation-periods 1 --threshold 500 --comparison-operator GreaterThanThreshold');
    expect((await e.run(`cloudwatch put-composite-alarm --alarm-name grave --alarm-rule 'ALARM("altas-pedidos") AND ALARM("fantasma")'`)).stderr).toContain("Alarm 'fantasma' referenced in the rule does not exist");
    await e.run(`cloudwatch put-composite-alarm --alarm-name grave --alarm-rule 'ALARM("altas-pedidos") AND ALARM("latencia-alta")' --alarm-actions ${topic}`);
    const comp = async () => (await e.json('cloudwatch describe-alarms --alarm-types CompositeAlarm')).CompositeAlarms[0];
    expect((await comp()).StateValue).toBe('OK');
    await e.run('cloudwatch put-metric-data --namespace App/Tienda --metric-name Pedidos --value 30');
    expect((await comp()).StateValue).toBe('OK');
    expect(e.acct.regions['us-east-1'].sns[topic].messages).toHaveLength(0);
    await e.run('cloudwatch put-metric-data --namespace App/Tienda --metric-name Latencia --value 900');
    await e.run('sts get-caller-identity');
    expect((await comp()).StateValue).toBe('ALARM');
    expect(e.acct.regions['us-east-1'].sns[topic].messages).toHaveLength(1);
    // por defecto describe-alarms solo lista las de métricas
    expect((await e.json('cloudwatch describe-alarms')).CompositeAlarms).toEqual([]);
    expect((await e.run('cloudwatch delete-alarms --alarm-names altas-pedidos')).stderr).toContain('composite alarm grave depends on it');
    expect((await e.run('cloudwatch delete-alarms --alarm-names grave altas-pedidos')).code).toBe(0);
  });

  test('alarma con matemática de métricas', async () => {
    const e = mkEnv();
    const metrics = JSON.stringify([
      { Id: 'e', MetricStat: { Metric: { Namespace: 'App/Tienda', MetricName: 'Errores' }, Period: 60, Stat: 'Sum' }, ReturnData: false },
      { Id: 'p', MetricStat: { Metric: { Namespace: 'App/Tienda', MetricName: 'Peticiones' }, Period: 60, Stat: 'Sum' }, ReturnData: false },
      { Id: 'tasa', Expression: 'e/p*100', Label: 'Tasa de error', ReturnData: true },
    ]);
    await e.run(`cloudwatch put-metric-alarm --alarm-name tasa-errores --evaluation-periods 1 --threshold 5 --comparison-operator GreaterThanThreshold --metrics '${metrics}'`);
    await e.run(`cloudwatch put-metric-data --namespace App/Tienda --metric-data '[{"MetricName":"Errores","Value":1},{"MetricName":"Peticiones","Value":100}]'`);
    let a = (await e.json('cloudwatch describe-alarms --alarm-names tasa-errores')).MetricAlarms[0];
    expect(a.StateValue).toBe('OK');
    expect(a.Metrics).toHaveLength(3);
    minute(e);
    await e.run(`cloudwatch put-metric-data --namespace App/Tienda --metric-data '[{"MetricName":"Errores","Value":20},{"MetricName":"Peticiones","Value":100}]'`);
    a = (await e.json('cloudwatch describe-alarms --alarm-names tasa-errores')).MetricAlarms[0];
    expect(a.StateValue).toBe('ALARM');
    expect((await e.run(`cloudwatch put-metric-alarm --alarm-name x --evaluation-periods 1 --threshold 5 --comparison-operator GreaterThanThreshold --metric-name M --namespace N --metrics '${metrics}'`)).stderr).toContain('mutually exclusive');
  });

  test('el cambio de estado llega a EventBridge', async () => {
    const e = mkEnv();
    const q = (await e.json('sqs create-queue --queue-name cambios')).QueueUrl;
    const qArn = await e.json(`sqs get-queue-attributes --queue-url ${q} --attribute-names QueueArn --query Attributes.QueueArn`);
    const rule = (await e.json(`events put-rule --name alarmas --event-pattern '{"source":["aws.cloudwatch"],"detail-type":["CloudWatch Alarm State Change"],"detail":{"state":{"value":["ALARM"]}}}'`)).RuleArn;
    await e.run(`events put-targets --rule alarmas --targets Id=q,Arn=${qArn}`);
    const pol = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'events.amazonaws.com' }, Action: 'sqs:SendMessage', Resource: qArn, Condition: { ArnEquals: { 'aws:SourceArn': rule } } }] });
    await e.run(`sqs set-queue-attributes --queue-url ${q} --attributes '{"Policy":${JSON.stringify(pol)}}'`);
    await e.run(alarm());
    await e.run('cloudwatch put-metric-data --namespace App/Tienda --metric-name Pedidos --value 99');
    const m = await e.json(`sqs receive-message --queue-url ${q}`);
    const ev = JSON.parse(m.Messages[0].Body);
    expect(ev.source).toBe('aws.cloudwatch');
    expect(ev['detail-type']).toBe('CloudWatch Alarm State Change');
    expect(ev.detail.alarmName).toBe('altas-pedidos');
    expect(ev.detail.state.value).toBe('ALARM');
    expect(ev.detail.previousState.value).toBe('INSUFFICIENT_DATA');
    expect(ev.resources[0]).toBe('arn:aws:cloudwatch:us-east-1:123456789012:alarm:altas-pedidos');
  });
});

describe('Métricas de servicios', () => {
  async function lambda(e: TestEnv, name: string, code: string) {
    e.write(`${name}.zip`, zip({ 'lambda_function.py': code }));
    e.write('t.json', TRUST('lambda.amazonaws.com'));
    const r = (await e.json(`iam create-role --role-name ${name}-rol --assume-role-policy-document file://t.json`)).Role.Arn;
    await e.run(`iam attach-role-policy --role-name ${name}-rol --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole`);
    await e.json(`lambda create-function --function-name ${name} --runtime python3.12 --role ${r} --handler lambda_function.lambda_handler --zip-file fileb://${name}.zip`);
  }
  test('Lambda publica Invocations, Errors y Duration', async () => {
    const e = mkEnv();
    await lambda(e, 'cobros', 'def lambda_handler(event, ctx):\n    if event.get("mal"):\n        raise ValueError("boom")\n    return "ok"\n');
    await e.run(`lambda invoke --function-name cobros --payload '{}' --cli-binary-format raw-in-base64-out out.json`);
    await e.run(`lambda invoke --function-name cobros --payload '{"mal":1}' --cli-binary-format raw-in-base64-out out.json`);
    await e.run(`lambda invoke --function-name cobros --payload '{"mal":1}' --cli-binary-format raw-in-base64-out out.json`);
    const get = async (m: string, s: string) => {
      const dp = (await e.json(`cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name ${m} --dimensions Name=FunctionName,Value=cobros --start-time ${new Date(e.acct.clock - 3600000).toISOString()} --end-time ${new Date(e.acct.clock + 60000).toISOString()} --period 3600 --statistics ${s}`)).Datapoints;
      return dp.reduce((n: number, x: Record<string, number>) => n + x[s], 0);
    };
    expect(await get('Invocations', 'Sum')).toBe(3);
    expect(await get('Errors', 'Sum')).toBe(2);
    expect(await get('Duration', 'Maximum')).toBeGreaterThan(0);
    // una alarma sobre los errores
    await e.run('cloudwatch put-metric-alarm --alarm-name cobros-errores --namespace AWS/Lambda --metric-name Errors --dimensions Name=FunctionName,Value=cobros --statistic Sum --period 300 --evaluation-periods 1 --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold');
    expect((await e.json('cloudwatch describe-alarms --alarm-names cobros-errores')).MetricAlarms[0].StateValue).toBe('ALARM');
  });

  test('SQS: la profundidad de la cola dispara una alarma', async () => {
    const e = mkEnv();
    const q = (await e.json('sqs create-queue --queue-name pedidos')).QueueUrl;
    await e.run('cloudwatch put-metric-alarm --alarm-name cola-llena --namespace AWS/SQS --metric-name ApproximateNumberOfMessagesVisible --dimensions Name=QueueName,Value=pedidos --statistic Maximum --period 60 --evaluation-periods 2 --threshold 3 --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching');
    for (let i = 0; i < 5; i++) await e.run(`sqs send-message --queue-url ${q} --message-body m${i}`);
    minute(e);
    await e.run('sqs get-queue-attributes --queue-url ' + q + ' --attribute-names All');
    minute(e);
    expect((await e.json('cloudwatch describe-alarms --alarm-names cola-llena')).MetricAlarms[0].StateValue).toBe('ALARM');
  });
});

describe('CloudWatch: paneles', () => {
  test('put, get, list y delete con validación', async () => {
    const e = mkEnv();
    const body = JSON.stringify({ widgets: [{ type: 'metric', x: 0, y: 0, width: 12, height: 6, properties: { metrics: [['App/Tienda', 'Pedidos']], period: 300, stat: 'Sum', region: 'us-east-1', title: 'Pedidos' } }, { type: 'text', x: 12, y: 0, width: 6, height: 3, properties: { markdown: '# Tienda' } }] });
    const r = await e.json(`cloudwatch put-dashboard --dashboard-name tienda --dashboard-body '${body}'`);
    expect(r.DashboardValidationMessages).toEqual([]);
    expect((await e.json('cloudwatch list-dashboards')).DashboardEntries.map((d: { DashboardName: string }) => d.DashboardName)).toEqual(['tienda']);
    expect(JSON.parse((await e.json('cloudwatch get-dashboard --dashboard-name tienda')).DashboardBody).widgets).toHaveLength(2);
    const bad = await e.run(`cloudwatch put-dashboard --dashboard-name malo --dashboard-body '{"widgets":[{"type":"metric","properties":{"metrics":[]}}]}'`);
    expect(bad.stderr).toContain('Should NOT have fewer than 1 items');
    expect((await e.run(`cloudwatch put-dashboard --dashboard-name malo --dashboard-body 'no es json'`)).stderr).toContain('InvalidParameterInput');
    expect((await e.run(`cloudwatch put-dashboard --dashboard-name 'con espacio' --dashboard-body '{}'`)).stderr).toContain('DashboardName is invalid');
    await e.run('cloudwatch delete-dashboards --dashboard-names tienda');
    expect((await e.run('cloudwatch get-dashboard --dashboard-name tienda')).stderr).toContain('does not exist');
  });
});

describe('Logs: filtros de métricas', () => {
  async function setup() {
    const e = mkEnv();
    await e.run('logs create-log-group --log-group-name /app/api');
    await e.run('logs create-log-stream --log-group-name /app/api --log-stream-name i-1');
    return e;
  }
  const put = async (e: TestEnv, msgs: string[]) => {
    const events = msgs.map((message, i) => ({ timestamp: e.acct.clock + i, message }));
    return e.run(`logs put-log-events --log-group-name /app/api --log-stream-name i-1 --log-events '${JSON.stringify(events)}'`);
  };

  test('un filtro de términos cuenta errores desde que existe', async () => {
    const e = await setup();
    await put(e, ['ERROR antes de crear el filtro']);
    await e.run(`logs put-metric-filter --log-group-name /app/api --filter-name errores --filter-pattern ERROR --metric-transformations metricName=ErroresApi,metricNamespace=App/Api,metricValue=1,unit=Count`);
    expect((await e.json('logs describe-metric-filters --log-group-name /app/api')).metricFilters[0]).toMatchObject({ filterName: 'errores', filterPattern: 'ERROR' });
    expect((await e.json('logs describe-log-groups')).logGroups[0].metricFilterCount).toBe(1);
    await put(e, ['INFO todo bien', 'ERROR base de datos caída', 'ERROR timeout', 'WARN lento']);
    const dp = (await e.json(`cloudwatch get-metric-statistics --namespace App/Api --metric-name ErroresApi --start-time ${new Date(e.acct.clock - 600000).toISOString()} --end-time ${new Date(e.acct.clock + 120000).toISOString()} --period 600 --statistics Sum`)).Datapoints;
    expect(dp.reduce((n: number, x: { Sum: number }) => n + x.Sum, 0)).toBe(2);
    expect((await e.run('logs put-metric-filter --log-group-name /app/api --filter-name x --filter-pattern ERROR --metric-transformations metricName=A,metricNamespace=AWS/Mio,metricValue=1')).stderr).toContain('reserved');
    await e.run('logs delete-metric-filter --log-group-name /app/api --filter-name errores');
    expect((await e.run('logs delete-metric-filter --log-group-name /app/api --filter-name errores')).stderr).toContain('ResourceNotFoundException');
  });

  test('patrones JSON y valores de métrica extraídos', async () => {
    const e = await setup();
    await e.run(`logs put-metric-filter --log-group-name /app/api --filter-name lentas --filter-pattern '{ $.status = 200 && $.ms > 500 }' --metric-transformations metricName=LatenciaLenta,metricNamespace=App/Api,metricValue='$.ms',unit=Milliseconds`);
    await put(e, [JSON.stringify({ status: 200, ms: 800, path: '/a' }), JSON.stringify({ status: 200, ms: 100, path: '/b' }), JSON.stringify({ status: 500, ms: 900, path: '/c' }), 'no es json', JSON.stringify({ status: 200, ms: 1200, path: '/d' })]);
    const dp = (await e.json(`cloudwatch get-metric-statistics --namespace App/Api --metric-name LatenciaLenta --start-time ${new Date(e.acct.clock - 600000).toISOString()} --end-time ${new Date(e.acct.clock + 120000).toISOString()} --period 600 --statistics Sum SampleCount Maximum`)).Datapoints[0];
    expect(dp).toMatchObject({ Sum: 2000, SampleCount: 2, Maximum: 1200, Unit: 'Milliseconds' });
  });

  test('test-metric-filter con texto separado por espacios', async () => {
    const e = await setup();
    const lines = ['10.0.0.1 - ana [10/Oct/2026:13:55:36] "GET /x HTTP/1.1" 200 2326', '10.0.0.2 - luis [10/Oct/2026:13:55:40] "GET /y HTTP/1.1" 404 120', '10.0.0.3 - eva [10/Oct/2026:13:55:41] "POST /z HTTP/1.1" 503 7'];
    const r = await e.json(`logs test-metric-filter --filter-pattern '[ip, id, user, ts, request, status=4* || status=5*, bytes]' --log-event-messages '${lines[0]}' '${lines[1]}' '${lines[2]}'`).catch(() => null);
    void r;
    const r2 = await e.json(`logs test-metric-filter --filter-pattern '[ip, id, user, ts, request, status=40*, bytes]' --log-event-messages '${lines[0]}' '${lines[1]}'`);
    expect(r2.matches).toHaveLength(1);
    expect(r2.matches[0].extractedValues).toMatchObject({ $ip: '10.0.0.2', $status: '404', $bytes: '120' });
    expect((await e.run(`logs test-metric-filter --filter-pattern '{ $.a = }' --log-event-messages x`)).stderr).toContain('InvalidParameterException');
    expect((await e.json(`logs test-metric-filter --filter-pattern '?ERROR ?WARN' --log-event-messages 'a ERROR' 'b' 'c WARN'`)).matches).toHaveLength(2);
  });

  test('la métrica de un filtro alimenta una alarma', async () => {
    const e = await setup();
    await e.run(`logs put-metric-filter --log-group-name /app/api --filter-name errores --filter-pattern ERROR --metric-transformations metricName=ErroresApi,metricNamespace=App/Api,metricValue=1`);
    await e.run('cloudwatch put-metric-alarm --alarm-name api-errores --namespace App/Api --metric-name ErroresApi --statistic Sum --period 300 --evaluation-periods 1 --threshold 3 --comparison-operator GreaterThanOrEqualToThreshold --treat-missing-data notBreaching');
    expect((await e.json('cloudwatch describe-alarms --alarm-names api-errores')).MetricAlarms[0].StateValue).toBe('OK');
    await put(e, ['ERROR a', 'ERROR b', 'ERROR c']);
    expect((await e.json('cloudwatch describe-alarms --alarm-names api-errores')).MetricAlarms[0].StateValue).toBe('ALARM');
  });
});

describe('Logs Insights', () => {
  async function setup() {
    const e = mkEnv();
    await e.run('logs create-log-group --log-group-name /app/api');
    await e.run('logs create-log-stream --log-group-name /app/api --log-stream-name i-1');
    const base = e.acct.clock;
    const rows = [
      { status: 200, ms: 100, path: '/home', user: 'ana' },
      { status: 200, ms: 250, path: '/home', user: 'luis' },
      { status: 500, ms: 900, path: '/pago', user: 'ana' },
      { status: 404, ms: 20, path: '/zzz', user: 'eva' },
      { status: 500, ms: 1100, path: '/pago', user: 'luis' },
      { status: 200, ms: 300, path: '/pago', user: 'eva' },
    ];
    const events = rows.map((r, i) => ({ timestamp: base - (rows.length - i) * 1000, message: JSON.stringify(r) }));
    await e.run(`logs put-log-events --log-group-name /app/api --log-stream-name i-1 --log-events '${JSON.stringify(events)}'`);
    return e;
  }
  const query = async (e: TestEnv, q: string, extra = '') => {
    const s = Math.floor((e.acct.clock - 3600000) / 1000);
    const end = Math.floor((e.acct.clock + 60000) / 1000);
    const id = (await e.json(`logs start-query --log-group-name /app/api --start-time ${s} --end-time ${end} --query-string '${q}' ${extra}`)).queryId;
    const r = await e.json(`logs get-query-results --query-id ${id}`);
    return r as { status: string; results: { field: string; value: string }[][]; statistics: { recordsMatched: number; recordsScanned: number } };
  };
  const table = (r: { results: { field: string; value: string }[][] }) => r.results.map((row) => Object.fromEntries(row.filter((c) => c.field !== '@ptr').map((c) => [c.field, c.value])));

  test('fields, filter, sort y limit', async () => {
    const e = await setup();
    const r = await query(e, 'fields path, ms | filter status = 500 | sort ms desc | limit 5');
    expect(r.status).toBe('Complete');
    expect(table(r)).toEqual([{ path: '/pago', ms: '1100' }, { path: '/pago', ms: '900' }]);
    expect(r.statistics.recordsScanned).toBe(6);
    expect(r.statistics.recordsMatched).toBe(2);
    expect(r.results[0].some((c) => c.field === '@ptr')).toBe(true);
    const t = await query(e, 'fields @timestamp, @message | sort @timestamp asc | limit 1');
    expect(t.results[0][0].field).toBe('@timestamp');
    expect(t.results[0][0].value).toMatch(/^2026-03-14 \d\d:\d\d:\d\d\.\d{3}$/);
    expect(JSON.parse(t.results[0][1].value)).toMatchObject({ user: 'ana', status: 200 });
  });

  test('stats con agrupación, percentiles y operadores', async () => {
    const e = await setup();
    expect(table(await query(e, 'stats count(*) as peticiones, avg(ms) as media by status | sort status'))).toEqual([
      { status: '200', peticiones: '3', media: '216.666667' },
      { status: '404', peticiones: '1', media: '20' },
      { status: '500', peticiones: '2', media: '1000' },
    ]);
    expect(table(await query(e, 'filter ms > 200 and path like "pago" | stats count(*) as n, max(ms) as peor, pct(ms, 50) as p50'))).toEqual([{ n: '3', peor: '1100', p50: '900' }]);
    expect(table(await query(e, 'stats count_distinct(user) as usuarios'))).toEqual([{ usuarios: '3' }]);
    expect(table(await query(e, 'filter status in [404, 500] | stats sum(ms) as total by path | sort total desc'))).toEqual([{ path: '/pago', total: '2000' }, { path: '/zzz', total: '20' }]);
    expect(table(await query(e, 'filter path =~ /^\\/(home|zzz)$/ | stats count(*)'))).toEqual([{ 'count(*)': '3' }]);
    expect(table(await query(e, 'filter ispresent(user) and strlen(user) = 3 | stats count(*) as n by toupper(user) as quien | sort n desc, quien'))[0]).toEqual({ quien: 'ANA', n: '2' });
  });

  test('bin agrupa por tramos de tiempo y parse extrae campos', async () => {
    const e = await setup();
    const r = await query(e, 'stats count(*) as n by bin(1d)');
    expect(r.results).toHaveLength(1);
    expect(r.results[0][0].field).toBe('bin(1d)');
    expect(r.results[0][1]).toEqual({ field: 'n', value: '6' });
    // parse sobre texto libre
    await e.run('logs create-log-stream --log-group-name /app/api --log-stream-name i-2');
    const ts = e.acct.clock;
    const lines = ['user=ana action=login ms=40', 'user=luis action=pay ms=300', 'user=ana action=pay ms=500', 'sin formato'];
    await e.run(`logs put-log-events --log-group-name /app/api --log-stream-name i-2 --log-events '${JSON.stringify(lines.map((message, i) => ({ timestamp: ts + i, message })))}'`);
    const p = await query(e, 'parse @message "user=* action=* ms=*" as u, a, t | stats count(*) as n, avg(t) as media by a | sort a');
    expect(table(p)).toEqual([{ a: 'login', n: '1', media: '40' }, { a: 'pay', n: '2', media: '400' }]);
    const d = await query(e, 'filter ispresent(status) | dedup path | fields path | sort path');
    expect(table(d).map((x) => x.path)).toEqual(['/home', '/pago', '/zzz']);
  });

  test('registros de Lambda: campos @duration y @maxMemoryUsed', async () => {
    const e = mkEnv();
    await e.run('logs create-log-group --log-group-name /aws/lambda/f');
    await e.run('logs create-log-stream --log-group-name /aws/lambda/f --log-stream-name s');
    const msgs = ['START RequestId: a1 Version: $LATEST', 'REPORT RequestId: a1\tDuration: 120.50 ms\tBilled Duration: 121 ms\tMemory Size: 128 MB\tMax Memory Used: 40 MB', 'REPORT RequestId: a2\tDuration: 80.00 ms\tBilled Duration: 80 ms\tMemory Size: 128 MB\tMax Memory Used: 44 MB\tInit Duration: 200.00 ms'];
    await e.run(`logs put-log-events --log-group-name /aws/lambda/f --log-stream-name s --log-events '${JSON.stringify(msgs.map((message, i) => ({ timestamp: e.acct.clock + i, message })))}'`);
    const s = Math.floor((e.acct.clock - 600000) / 1000);
    const id = (await e.json(`logs start-query --log-group-name /aws/lambda/f --start-time ${s} --end-time ${s + 1200} --query-string 'filter @type = "REPORT" | stats avg(@duration) as media, max(@maxMemoryUsed / 1024 / 1024) as memoria, count(@initDuration) as fríos'`)).queryId;
    const r = await e.json(`logs get-query-results --query-id ${id}`);
    expect(r.results[0]).toEqual([{ field: 'media', value: '100.25' }, { field: 'memoria', value: '44' }, { field: 'fríos', value: '1' }]);
  });

  test('errores: consulta mal escrita, grupo inexistente y get-query-results', async () => {
    const e = await setup();
    const s = Math.floor((e.acct.clock - 3600000) / 1000);
    const go = (q: string, g = '/app/api') => e.run(`logs start-query --log-group-name ${g} --start-time ${s} --end-time ${s + 7200} --query-string '${q}'`);
    expect((await go('fields path | filtro status = 1')).stderr).toContain('MalformedQueryException');
    expect((await go('stats path')).stderr).toContain('stats needs an aggregate function');
    expect((await go('')).stderr).toBeTruthy();
    expect((await go('fields a', '/no/existe')).stderr).toContain('ResourceNotFoundException');
    expect((await e.run('logs get-query-results --query-id 00000000-0000-0000-0000-000000000000')).stderr).toContain('ResourceNotFoundException');
    expect((await e.run(`logs start-query --start-time ${s} --end-time ${s + 1} --query-string 'fields a'`)).stderr).toContain('Either logGroupName');
  });
});

describe('aws logs tail', () => {
  test('muestra lo reciente con --since y --filter-pattern', async () => {
    const e = mkEnv();
    await e.run('logs create-log-group --log-group-name /app/api');
    await e.run('logs create-log-stream --log-group-name /app/api --log-stream-name i-1');
    const t = e.acct.clock;
    await e.run(`logs put-log-events --log-group-name /app/api --log-stream-name i-1 --log-events '${JSON.stringify([{ timestamp: t - 3 * 3600000, message: 'muy viejo' }, { timestamp: t - 60000, message: 'INFO hola' }, { timestamp: t - 30000, message: 'ERROR adiós' }])}'`);
    const all = (await e.run('logs tail /app/api --since 1h')).stdout.trim().split('\n');
    expect(all).toHaveLength(2);
    expect(all[0]).toMatch(/^2026-03-14T\d\d:\d\d:\d\d\.\d{6}\+00:00 i-1 INFO hola$/);
    expect((await e.run('logs tail /app/api --since 4h')).stdout.trim().split('\n')).toHaveLength(3);
    expect((await e.run('logs tail /app/api --since 1h --filter-pattern ERROR --format short')).stdout.trim()).toMatch(/^2026-03-14T\d\d:\d\d:\d\d ERROR adiós$/);
    expect((await e.run('logs tail /no/existe')).stderr).toContain('ResourceNotFoundException');
  });
});
