import { alarmSummary, alarmTimeline, filterEvents, fleetStatus, logMatches, traceModel, TRAIL_EVENTS } from '../awsOpsLogic';

const SERIES: (number | null)[] = [180, 210, 190, 950, 200, 220, 900, 940, 960, 210, null, null, null, 230];
const setup = (o: Partial<Parameters<typeof alarmTimeline>[1]> = {}) => ({ threshold: 800, periods: 3, datapoints: 2, missing: 'missing' as const, ...o });

describe('alarmas', () => {
  test('1 de 1 salta con el pico aislado; 2 de 3 no', () => {
    const noisy = alarmTimeline(SERIES, setup({ periods: 1, datapoints: 1 }));
    expect(noisy[3]).toBe('ALARM');
    const calm = alarmTimeline(SERIES, setup());
    expect(calm[3]).toBe('OK');
    expect(calm[7]).toBe('ALARM');
    expect(alarmSummary(noisy).changes).toBeGreaterThan(alarmSummary(calm).changes);
  });

  test('los datos que faltan', () => {
    // sin datos durante 3 minutos con 3 periodos: INSUFFICIENT_DATA (missing), OK (notBreaching), ALARM (breaching)
    const at = (m: 'missing' | 'notBreaching' | 'breaching' | 'ignore', k = 12) => alarmTimeline(SERIES, setup({ missing: m, datapoints: 3 }))[k];
    expect(at('missing')).toBe('INSUFFICIENT_DATA');
    expect(at('notBreaching')).toBe('OK');
    expect(at('breaching')).toBe('ALARM');
    // ignore conserva el estado anterior (el de antes de los huecos: OK)
    expect(at('ignore')).toBe('OK');
  });

  test('sin periodos suficientes al principio hay pocos datos', () => {
    expect(alarmTimeline([100], setup())[0]).toBe('OK');
    expect(alarmTimeline([null], setup())[0]).toBe('INSUFFICIENT_DATA');
  });
});

describe('patrones de filtro', () => {
  const L = {
    err: '{"level":"ERROR","route":"/api/pedidos","status":500,"latency":5000}',
    ok: '{"level":"INFO","route":"/api/pago","status":200,"latency":340}',
    pago: '{"level":"INFO","route":"/api/pago","status":200,"latency":500}',
    txt: '2026-03-14 11:02:10 ERROR timeout contacting db',
    warn: '2026-03-14 11:02:12 WARN disk 91% on /var',
  };
  test('texto', () => {
    expect(logMatches('ERROR', L.err)).toBe(true);
    expect(logMatches('ERROR', L.ok)).toBe(false);
    expect(logMatches('?ERROR ?WARN', L.warn)).toBe(true);
    expect(logMatches('?ERROR ?WARN', L.ok)).toBe(false);
    expect(logMatches('ERROR -timeout', L.txt)).toBe(false);
    expect(logMatches('ERROR -timeout', L.err)).toBe(true);
    expect(logMatches('"disk 91%"', L.warn)).toBe(true);
  });
  test('JSON', () => {
    expect(logMatches('{ $.status >= 500 }', L.err)).toBe(true);
    expect(logMatches('{ $.status >= 500 }', L.ok)).toBe(false);
    expect(logMatches('{ $.status >= 500 }', L.txt)).toBe(false);
    expect(logMatches('{ $.route = "/api/pago" && $.latency > 300 }', L.pago)).toBe(true);
    expect(logMatches('{ $.route = "/api/pago" && $.latency > 400 }', L.ok)).toBe(false);
    expect(logMatches('{ $.status = 500 || $.latency > 400 }', L.pago)).toBe(true);
  });
});

describe('CloudTrail y Systems Manager', () => {
  test('filtros de eventos', () => {
    expect(filterEvents(TRAIL_EVENTS, { user: 'carlos', writeOnly: true }).map((e) => e.id)).toEqual(['e6']);
    expect(filterEvents(TRAIL_EVENTS, { name: 'AuthorizeSecurityGroupIngress' })).toHaveLength(2);
    expect(filterEvents(TRAIL_EVENTS, { writeOnly: true }).every((e) => !e.readOnly)).toBe(true);
    expect(TRAIL_EVENTS.find((e) => e.error)?.user).toBe('lucia');
  });
  test('flota', () => {
    expect(fleetStatus({ role: true, agent: true, internet: true, endpoints: false })).toEqual({ online: true, reason: 'ok' });
    expect(fleetStatus({ role: true, agent: true, internet: false, endpoints: true }).online).toBe(true);
    expect(fleetStatus({ role: false, agent: true, internet: true, endpoints: false }).reason).toBe('no-role');
    expect(fleetStatus({ role: true, agent: false, internet: true, endpoints: false }).reason).toBe('no-agent');
    expect(fleetStatus({ role: true, agent: true, internet: false, endpoints: false }).reason).toBe('no-network');
  });
});

describe('traza', () => {
  test('el cuello de botella es quien concentra el tiempo propio', () => {
    const slow = traceModel({ inventarioMs: 2000, ddbFault: false, retry: false });
    expect(slow.bottleneck).toBe('inventario');
    expect(slow.total).toBe(30 + 2000 + 8);
    expect(slow.segs[0]).toMatchObject({ name: 'checkout', depth: 0, self: 30 });
    const fast = traceModel({ inventarioMs: 10, ddbFault: false, retry: false });
    expect(fast.bottleneck).toBe('checkout');
    expect(traceModel({ inventarioMs: 100, ddbFault: true, retry: false }).segs[0].fault).toBe(true);
    expect(traceModel({ inventarioMs: 100, ddbFault: false, retry: true }).segs.map((s) => s.name)).toContain('inventario (reintento)');
  });
});
