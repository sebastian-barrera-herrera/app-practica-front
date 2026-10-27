import { mkEnv } from './helpers';

const SC = ['srv-lambda', 'srv-lambda-demo', 'srv-lambda-roto', 'srv-lambda-lenta', 'srv-lambda-sinlogs', 'srv-api', 'srv-api-500', 'srv-api-post', 'srv-fanout', 'srv-veneno', 'srv-cron', 'srv-eventos', 'srv-sfn', 'srv-sfn-roto', 'srv-auth', 'srv-s3ev', 'srv-boss'];

describe('escenarios de serverless', () => {
  test.each(SC)('%s se construye', (s) => {
    expect(() => mkEnv({ scenario: s })).not.toThrow();
  });

  test('la función lenta agota el tiempo con 128 MB y no con 512', async () => {
    const e = mkEnv({ scenario: 'srv-lambda-lenta' });
    e.io.god = true;
    const slow = await e.json('_check invoke --function calcula');
    expect(slow.FunctionError).toBe('Unhandled');
    expect(JSON.stringify(slow.Payload)).toContain('Task timed out after 1.00 seconds');
    e.io.god = false;
    await e.run('lambda update-function-configuration --function-name calcula --memory-size 512');
    e.io.god = true;
    const fast = await e.json('_check invoke --function calcula');
    expect(fast.FunctionError).toBeNull();
    expect(fast.DurationMs).toBeLessThan(1000);
    expect(fast.DurationMs).toBeGreaterThan(200);
  });

  test('informe: el handler está mal y el tiempo es corto', async () => {
    const e = mkEnv({ scenario: 'srv-lambda-roto' });
    e.io.god = true;
    expect(JSON.stringify((await e.json('_check invoke --function informe')).Payload)).toContain('HandlerNotFound');
    e.io.god = false;
    await e.run('lambda update-function-configuration --function-name informe --handler lambda_function.lambda_handler');
    e.io.god = true;
    expect(JSON.stringify((await e.json('_check invoke --function informe')).Payload)).toContain('Task timed out');
    e.io.god = false;
    await e.run('lambda update-function-configuration --function-name informe --timeout 10');
    e.io.god = true;
    expect((await e.json('_check invoke --function informe')).Payload).toEqual({ informe: 'listo', filas: 120 });
  });

  test('veneno: el mensaje malo no se va solo; con DLQ acaba apartado', async () => {
    const e = mkEnv({ scenario: 'srv-veneno' });
    for (let k = 0; k < 10; k++) {
      e.acct.clock += 60000;
      await e.run('sqs list-queues');
    }
    const attrs = await e.json(`sqs get-queue-attributes --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/trabajos --attribute-names All`);
    expect(Number(attrs.Attributes.ApproximateNumberOfMessages) + Number(attrs.Attributes.ApproximateNumberOfMessagesNotVisible)).toBe(1);
  });
});
