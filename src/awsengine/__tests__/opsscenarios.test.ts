import { Terminal } from '../../engine/terminal';
import { awsQuery } from '../check';

const mk = (aws: string, files: Record<string, string> = {}) => new Terminal({ instant: true, aws, cols: 160, files });
const out = async (t: Terminal, cmd: string) => (await t.exec(cmd)).out.trim();
/** Una consulta «de dios» (la que usa el corrector) sobre una copia de la cuenta. */
const god = (t: Terminal, cmd: string, pre?: string[]) => (awsQuery(t, cmd, pre)?.stdout ?? '').trim();

describe('escenarios de operaciones', () => {
  test('ops-metricas: un tema con una cola suscrita', async () => {
    const t = mk('ops-metricas');
    expect(await out(t, 'aws sns list-topics --query "Topics[0].TopicArn" --output text')).toBe('arn:aws:sns:us-east-1:123456789012:alertas');
    expect(await out(t, 'aws sns list-subscriptions --query "Subscriptions[0].Protocol" --output text')).toBe('sqs');
    expect(await out(t, 'aws cloudwatch describe-alarms --query "length(MetricAlarms)"')).toBe('0');
  });

  test('ops-compuesta: dos alarmas con aviso propio', async () => {
    const t = mk('ops-compuesta');
    expect(await out(t, 'aws cloudwatch describe-alarms --query "MetricAlarms[].AlarmName" --output text')).toMatch(/errores-altos\s+latencia-alta|latencia-alta\s+errores-altos/);
  });

  test('ops-alarma-muda: sin datos y con la acción rota', async () => {
    const t = mk('ops-alarma-muda');
    expect(await out(t, 'aws cloudwatch describe-alarms --query "MetricAlarms[0].StateValue" --output text')).toBe('INSUFFICIENT_DATA');
    expect(await out(t, 'aws cloudwatch list-metrics --namespace Tienda --query "length(Metrics)"')).toBe('2');
  });

  test('ops-logs: registros de la API y un pago rechazado', async () => {
    const t = mk('ops-logs');
    expect(await out(t, 'aws logs filter-log-events --log-group-name /tienda/api --filter-pattern PaymentDeclined --query "length(events)"')).toBe('1');
    expect(await out(t, 'aws logs filter-log-events --log-group-name /tienda/api --filter-pattern "{ $.status = 500 }" --query "length(events)"')).toBe('3');
  });

  test('ops-auditoria: CloudTrail sabe quién abrió el 22', async () => {
    const t = mk('ops-auditoria');
    expect(await out(t, 'aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=AuthorizeSecurityGroupIngress --query "Events[].Username" --output text')).toBe('carlos\tana');
    expect(await out(t, 'aws ec2 describe-security-groups --filters Name=group-name,Values=web-sg --query "SecurityGroups[0].IpPermissions[].FromPort" --output text')).toBe('80\t22');
  });

  test('ops-trail y ops-config', async () => {
    const t = mk('ops-trail');
    expect(await out(t, 'aws cloudtrail describe-trails --query "length(trailList)"')).toBe('0');
    const c = mk('ops-config');
    expect(await out(c, 'aws configservice describe-configuration-recorders --query "length(ConfigurationRecorders)"')).toBe('0');
    expect(await out(c, 'aws iam get-role --role-name remediacion --query Role.RoleName --output text')).toBe('remediacion');
  });
});

describe('escenarios de operaciones (2)', () => {
  test('ops-ssm-run: tres servidores administrados', async () => {
    const t = mk('ops-ssm-run');
    expect(await out(t, 'aws ssm describe-instance-information --query "length(InstanceInformationList)"')).toBe('3');
  });

  test('ops-ssm-parches y ops-eventos', async () => {
    const t = mk('ops-ssm-parches');
    expect(await out(t, 'aws ssm describe-instance-information --query "length(InstanceInformationList)"')).toBe('2');
    const e = mk('ops-eventos');
    expect(await out(e, 'aws cloudwatch describe-alarms --query "MetricAlarms[0].AlarmName" --output text')).toBe('web-lenta');
  });

  test('ops-ssm-params: la función falla hasta que existan los parámetros', async () => {
    const t = mk('ops-ssm-params');
    expect(god(t, '_check invoke --function pedidos --query FunctionError')).not.toBe('null');
  });

  test('ops-trazas y ops-trazas-ok', async () => {
    const t = mk('ops-trazas');
    expect(god(t, '_check invoke --function checkout --query Payload.stock')).toBe('12');
    expect(god(t, '_check traces --query Traces')).toBe('0');
    const k = mk('ops-trazas-ok');
    expect(Number(god(k, '_check traces --query Traces'))).toBeGreaterThan(0);
    expect(god(k, '_check traces --query Services')).toContain('inventario');
  });

  test('ops-boss: pedidos falla por el cambio de becario', async () => {
    const t = mk('ops-boss');
    expect(god(t, '_check invoke --function pedidos --query FunctionError')).toBe('"Unhandled"');
    expect(await out(t, 'aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=UpdateFunctionConfiguration --query "Events[0].Username" --output text')).toBe('becario');
  });
});
