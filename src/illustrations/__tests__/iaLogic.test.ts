import { AI_LAYERS, LEARNING_TYPES, broadcast, fitData, fitDegree, gdPath, gdVerdict, lcg, lstsq, monteCarloPi, mse, polyEval, polyFit, splitDemo, vecFrom, vecStats } from '../iaLogic';

describe('mínimos cuadrados', () => {
  test('lstsq resuelve un sistema exacto', () => {
    const c = lstsq([[1, 0], [0, 1], [1, 1]], [2, 3, 5]);
    expect(c[0]).toBeCloseTo(2);
    expect(c[1]).toBeCloseTo(3);
  });

  test('polyFit recupera una recta y una parábola', () => {
    const xs = [0, 1, 2, 3, 4];
    const l = polyFit(xs, xs.map((x) => 2 * x + 1), 1);
    expect(l[0]).toBeCloseTo(2);
    expect(l[1]).toBeCloseTo(1);
    const q = polyFit(xs, xs.map((x) => x * x - 3 * x + 2), 2);
    expect(q.map((v) => +v.toFixed(6))).toEqual([1, -3, 2]);
    expect(polyEval(q, 5)).toBeCloseTo(12);
  });

  test('coincide con np.polyfit (grado 3 sobre los datos de la ilustración)', () => {
    // numpy: np.polyfit(xt, yt, 3) con los mismos datos
    const d = fitData();
    const c = polyFit(d.xt, d.yt, 3);
    const pred = d.xt.map((x) => polyEval(c, x));
    expect(mse(pred, d.yt)).toBeLessThan(0.03);
  });
});

describe('infraajuste y sobreajuste', () => {
  const d = fitData();
  test('el error de entrenamiento no sube al subir el grado', () => {
    let prev = Infinity;
    for (let g = 1; g <= 8; g++) {
      const r = fitDegree(d, g);
      expect(r.trainErr).toBeLessThanOrEqual(prev + 1e-9);
      prev = r.trainErr;
    }
  });
  test('el error de prueba tiene forma de U', () => {
    const e = Array.from({ length: 8 }, (_, i) => fitDegree(d, i + 1).testErr);
    const best = e.indexOf(Math.min(...e)) + 1;
    expect(best).toBeGreaterThanOrEqual(3);
    expect(best).toBeLessThanOrEqual(6);
    expect(e[7]).toBeGreaterThan(e[best - 1] * 5);
  });
  test('los veredictos son coherentes', () => {
    expect(fitDegree(d, 1).verdict).toBe('infraajuste');
    expect(fitDegree(d, 3).verdict).toBe('bien');
    expect(fitDegree(d, 8).verdict).toBe('sobreajuste');
  });
  test('la curva tiene 101 puntos', () => {
    expect(fitDegree(d, 3).curve.x).toHaveLength(101);
  });
});

describe('memoria contra regla', () => {
  test('la memoria clava el entrenamiento y la regla generaliza mejor', () => {
    const r = splitDemo(20);
    expect(r.memTrain).toBe(1);
    expect(r.memTest).toBeLessThan(r.memTrain);
    expect(r.ruleTest).toBeGreaterThanOrEqual(r.memTest);
    expect(r.nTrain + r.nTest).toBe(30);
  });
  test('los extremos se acotan', () => {
    expect(splitDemo(0).nTrain).toBe(2);
    expect(splitDemo(999).nTest).toBe(2);
  });
});

describe('datos de las ilustraciones', () => {
  test('capas y tipos completos', () => {
    expect(AI_LAYERS.map((l) => l.id)).toEqual(['ia', 'ml', 'dl', 'gen']);
    expect(LEARNING_TYPES.map((l) => l.id)).toEqual(['sup', 'uns', 'rl']);
    for (const l of LEARNING_TYPES) expect(l.algos.length).toBeGreaterThanOrEqual(3);
  });
});

describe('broadcasting', () => {
  test('formas compatibles', () => {
    expect(broadcast([3, 4], [4])).toMatchObject({ ok: true, shape: [3, 4] });
    expect(broadcast([5, 1], [1, 4])).toMatchObject({ ok: true, shape: [5, 4] });
    expect(broadcast([2, 3, 4], [3, 1])).toMatchObject({ ok: true, shape: [2, 3, 4] });
    expect(broadcast([3], [1])).toMatchObject({ ok: true, shape: [3] });
  });
  test('formas incompatibles explican el fallo', () => {
    const r = broadcast([3, 2], [3]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('ValueError: operands could not be broadcast together with shapes (3, 2) (3,)');
    expect(r.steps[0]).toMatchObject({ axis: 0, a: 2, b: 3, ok: false });
  });
  test('compara de derecha a izquierda', () => {
    const r = broadcast([3, 4], [4]);
    expect(r.steps.map((s) => [s.a, s.b, s.out])).toEqual([[4, 4, 4], [3, null, 3]]);
  });
});

describe('vectores', () => {
  test('coseno y producto escalar', () => {
    const a = vecFrom(0, 2);
    expect(vecStats(a, vecFrom(0, 5)).cos).toBeCloseTo(1);
    expect(vecStats(a, vecFrom(90, 3)).cos).toBeCloseTo(0);
    expect(vecStats(a, vecFrom(180, 1)).cos).toBeCloseTo(-1);
    expect(vecStats(a, vecFrom(0, 3)).dot).toBeCloseTo(6);
    expect(vecStats(a, vecFrom(90, 3)).kind).toBe('perpendiculares');
    expect(vecStats(a, vecFrom(180, 1)).kind).toBe('sentidos opuestos');
  });
  test('el coseno ignora la longitud', () => {
    expect(vecStats(vecFrom(30, 1), vecFrom(75, 1)).cos).toBeCloseTo(vecStats(vecFrom(30, 9), vecFrom(75, 0.2)).cos);
  });
  test('un vector nulo no rompe nada', () => {
    expect(vecStats({ x: 0, y: 0 }, vecFrom(10, 1)).cos).toBe(0);
  });
});

describe('Monte Carlo', () => {
  test('el generador es reproducible y uniforme', () => {
    const a = lcg(1);
    const b = lcg(1);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const r = lcg(5);
    const xs = Array.from({ length: 2000 }, r);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(xs.reduce((s, v) => s + v, 0) / xs.length).toBeCloseTo(0.5, 1);
  });
  test('con muchos puntos π se acerca', () => {
    expect(Math.abs(monteCarloPi(20000).pi - Math.PI)).toBeLessThan(0.05);
    expect(monteCarloPi(0).pi).toBe(0);
  });
});

describe('descenso del gradiente', () => {
  test('converge con una tasa pequeña', () => {
    const p = gdPath(0, 0.1, 40);
    expect(p[p.length - 1].x).toBeCloseTo(3, 2);
    expect(gdVerdict(p, 0.1)).toBe('converge');
  });
  test('con tasa 1.1 diverge y con 1.0 rebota', () => {
    expect(gdVerdict(gdPath(0, 1.1, 15), 1.1)).toBe('diverge');
    const z = gdPath(0, 1.0, 10);
    expect(z.map((s) => s.x).slice(0, 4)).toEqual([0, 6, 0, 6]);
    expect(gdVerdict(z, 1.0)).toBe('zigzag');
  });
  test('con tasa muy pequeña es lento', () => {
    expect(gdVerdict(gdPath(0, 0.01, 10), 0.01)).toBe('lento');
  });
});

import { LEAK_TEST, countPeaks, histData, histVerdict, histogram, leakDemo } from '../iaLogic';

describe('histograma y número de intervalos', () => {
  const data = histData();
  test('los conteos suman el total y los datos son reproducibles', () => {
    expect(data).toHaveLength(120);
    expect(histData()).toEqual(data);
    for (const b of [2, 5, 10, 30]) expect(histogram(data, b).counts.reduce((s, c) => s + c, 0)).toBe(120);
  });
  test('con pocos intervalos se pierde un grupo y con una cantidad razonable se ven dos', () => {
    expect(countPeaks(histogram(data, 2).counts)).toBe(1);
    expect(countPeaks(histogram(data, 12).counts)).toBe(2);
  });
  test('veredictos por tramos', () => {
    expect(histVerdict(2).kind).toBe('pocas');
    expect(histVerdict(12).kind).toBe('bien');
    expect(histVerdict(40).kind).toBe('muchas');
  });
});

describe('fuga de datos', () => {
  test('ajustar con todo esconde el valor extremo de la prueba', () => {
    const leak = leakDemo('todo');
    const ok = leakDemo('train');
    expect(ok.mean).toBeCloseTo(12);
    expect(leak.mean).toBeGreaterThan(ok.mean);
    expect(Math.abs(leak.z[1])).toBeLessThan(4);
    expect(Math.abs(ok.z[1])).toBeGreaterThan(30);
    expect(ok.fitted).toHaveLength(8);
    expect(LEAK_TEST).toEqual([12, 60]);
  });
});
