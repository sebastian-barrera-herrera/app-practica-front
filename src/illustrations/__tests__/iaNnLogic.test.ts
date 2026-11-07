import { ACT_NAMES, act, accuracyOf, bestGateScore, bpGraph, curve, dact, forwardXor, gateScore, lossOf, makeNet, moonsData, optPath, predict, softmax, trainEpochs, valley, type Act } from '../iaNnLogic';

describe('Z8 · la neurona', () => {
  it('AND y OR las resuelve una neurona; XOR no (máximo 3 de 4)', () => {
    expect(gateScore(1, 1, -1.5, 'paso', 'AND')).toBe(4);
    expect(gateScore(1, 1, -0.5, 'paso', 'OR')).toBe(4);
    expect(bestGateScore('AND')).toBe(4);
    expect(bestGateScore('OR')).toBe(4);
    expect(bestGateScore('XOR')).toBe(3);
    expect(bestGateScore('XOR', 'sigmoide')).toBe(3);
  });

  it('las activaciones valen lo que dice la lección', () => {
    expect(act('sigmoide', 0)).toBeCloseTo(0.5, 12);
    expect(act('relu', -3)).toBe(0);
    expect(act('leaky', -4)).toBeCloseTo(-0.4, 12);
    expect(act('tanh', 1)).toBeCloseTo(0.76159, 4);
    expect(dact('sigmoide', 0)).toBeCloseTo(0.25, 12);
    expect(dact('sigmoide', 8)).toBeLessThan(0.001);
    expect(Object.keys(ACT_NAMES)).toHaveLength(6);
  });

  it('la derivada analítica coincide con la numérica', () => {
    for (const a of ['sigmoide', 'tanh', 'relu', 'leaky', 'softplus'] as Act[])
      for (const z of [-2.3, -0.4, 0.7, 3.1]) {
        const num = (act(a, z + 1e-6) - act(a, z - 1e-6)) / 2e-6;
        expect(dact(a, z)).toBeCloseTo(num, 5);
      }
  });

  it('la curva tiene el número de puntos pedido', () => {
    expect(curve('tanh', -3, 3, 30)).toHaveLength(31);
  });
});

describe('Z8 · propagación', () => {
  it('con ReLU la red 2-2-1 hace XOR; sin activación no', () => {
    const tabla = (m: 'relu' | 'lineal') => [[0, 0], [0, 1], [1, 0], [1, 1]].map(([a, b]) => forwardXor(a, b, m).out);
    expect(tabla('relu')).toEqual([0, 1, 1, 0]);
    expect(tabla('lineal')).toEqual([2, 1, 1, 0]);
  });

  it('softmax suma 1 y no se desborda', () => {
    const p = softmax([1000, 1001, 1002]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(p[2]).toBeCloseTo(0.6652, 4);
    expect(softmax([1, 2, 3], 100)[0]).toBeGreaterThan(0.32);
  });
});

describe('Z8 · retropropagación', () => {
  it('el gradiente de la cadena coincide con el numérico', () => {
    const g = bpGraph(0.8, -0.5, 1.5, 1);
    const num = (bpGraph(0.8 + 1e-6, -0.5, 1.5, 1).loss - bpGraph(0.8 - 1e-6, -0.5, 1.5, 1).loss) / 2e-6;
    expect(g.dLdw).toBeCloseTo(num, 6);
    expect(g.dLdz * g.dzdw).toBeCloseTo(g.dLdw, 12);
    expect(g.dLdb).toBeCloseTo(g.dLdz, 12);
  });

  it('un paso de descenso baja la pérdida', () => {
    const g = bpGraph(0.8, -0.5, 1.5, 1);
    expect(bpGraph(0.8 - 0.5 * g.dLdw, -0.5 - 0.5 * g.dLdb, 1.5, 1).loss).toBeLessThan(g.loss);
  });
});

describe('Z8 · entrenamiento', () => {
  it('una red 2-8-1 aprende las dos lunas', () => {
    const data = moonsData(60, 3);
    expect(data).toHaveLength(60);
    const net = makeNet(8, 5);
    const l0 = lossOf(net, data);
    const hist = trainEpochs(net, data, 0.5, 600);
    expect(hist).toHaveLength(600);
    expect(hist[599]).toBeLessThan(l0);
    expect(hist[599]).toBeLessThan(0.3);
    expect(accuracyOf(net, data)).toBeGreaterThan(0.9);
    expect(net.epoch).toBe(600);
    expect(predict(net, 0, 0.5)).toBeGreaterThanOrEqual(0);
  });

  it('con una sola neurona oculta no se separan bien las lunas', () => {
    const data = moonsData(60, 3);
    const net = makeNet(1, 5);
    trainEpochs(net, data, 0.5, 600);
    expect(accuracyOf(net, data)).toBeLessThan(0.95);
  });
});

describe('Z8 · optimizadores', () => {
  it('con el mismo lr el momento y Adam llegan más abajo que SGD', () => {
    const sgd = optPath('sgd', 0.03, 100).loss;
    const mom = optPath('momento', 0.03, 100).loss;
    const adam = optPath('adam', 0.3, 100).loss;
    expect(sgd).toBeCloseTo(0.01809, 4);
    expect(mom).toBeLessThan(sgd);
    expect(adam).toBeLessThan(sgd);
  });

  it('un lr demasiado alto hace divergir a SGD', () => {
    expect(optPath('sgd', 0.081, 50).loss).toBeGreaterThan(valley(4, 1));
    expect(optPath('sgd', 0.07, 50).loss).toBeLessThan(0.01);
  });
});
