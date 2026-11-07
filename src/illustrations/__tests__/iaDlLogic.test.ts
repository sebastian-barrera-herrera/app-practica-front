import { IMG_L, KERNELS, agApply, agGrad, agInit, agLoss, applyShapeOp, bestEpoch, cellTrace, convolve2d, earlyStop, loopSim, maxPool, memoryOfFirst, outSize, overfitCurves, rnnTrace, shapeSize } from '../iaDlLogic';

describe('Z9 · formas', () => {
  it('encadena operaciones de forma como PyTorch', () => {
    const run = (s: number[], ...ops: Parameters<typeof applyShapeOp>[1][]) => ops.reduce<number[]>((cur, op) => {
      const r = applyShapeOp(cur, op);
      if ('error' in r) throw new Error(r.error);
      return r.shape;
    }, s);
    expect(run([3, 32, 32], 'unsqueeze0')).toEqual([1, 3, 32, 32]);
    expect(run([8, 3, 32, 32], 'flatten')).toEqual([8, 3072]);
    expect(run([1, 3, 1, 4], 'squeeze')).toEqual([3, 4]);
    expect(run([2, 3, 4], 'transpose')).toEqual([2, 4, 3]);
    expect(run([2, 3, 4], 'moveFirstLast')).toEqual([3, 4, 2]);
    expect(run([4, 10, 16], 'sumLast')).toEqual([4, 10]);
    expect(run([4, 10, 16], 'matmulW')).toEqual([4, 10, 5]);
    expect(shapeSize([8, 3, 32, 32])).toBe(24576);
  });

  it('da los errores de PyTorch', () => {
    expect(applyShapeOp([3, 5], 'reshapeHalf')).toEqual({ error: "RuntimeError: shape '[-1, 2]' is invalid for input of size 15" });
    expect(applyShapeOp([5], 'transpose')).toHaveProperty('error');
    expect(applyShapeOp([], 'sumFirst')).toHaveProperty('error');
  });
});

describe('Z9 · autograd', () => {
  it('backward acumula y zero_grad reinicia', () => {
    let s = agInit(0);
    s = agApply(s, 'forward');
    s = agApply(s, 'backward');
    expect(s.grad).toBeCloseTo(agGrad(0), 12);
    s = agApply(s, 'backward');
    expect(s.grad).toBeCloseTo(2 * agGrad(0), 12);
    s = agApply(s, 'zero_grad');
    expect(s.grad).toBeNull();
  });

  it('un paso de descenso con el gradiente correcto baja la pérdida', () => {
    let s = agInit(0);
    s = agApply(s, 'forward');
    s = agApply(s, 'backward');
    s = agApply(s, 'step', 0.05);
    expect(agLoss(s.w)).toBeLessThan(agLoss(0));
    expect(agApply(agInit(1), 'backward').grad).toBeNull();
    expect(agApply(agInit(1), 'step').w).toBe(1);
  });
});

describe('Z9 · bucle de entrenamiento', () => {
  it('el bucle correcto converge y los fallos típicos no', () => {
    const ok = loopSim('ninguno');
    expect(ok[ok.length - 1]).toBeLessThan(ok[0] * 0.01);
    const sinStep = loopSim('sin_step');
    expect(sinStep[29]).toBeCloseTo(sinStep[0], 12);
    const sinBack = loopSim('sin_backward');
    expect(sinBack[29]).toBeCloseTo(sinBack[0], 12);
    const sinZero = loopSim('sin_zero_grad');
    expect(sinZero[29]).toBeGreaterThan(ok[29] * 100);
  });
});

describe('Z9 · convolución', () => {
  it('el tamaño de salida sigue la fórmula', () => {
    expect(outSize(28, 3)).toBe(26);
    expect(outSize(28, 3, 1)).toBe(28);
    expect(outSize(28, 3, 0, 2)).toBe(13);
    expect(outSize(8, 2, 0, 2)).toBe(4);
  });

  it('el borde vertical responde en la frontera izquierda/derecha de la L', () => {
    const m = convolve2d(IMG_L, KERNELS.vertical.k);
    expect(m).toHaveLength(5);
    expect(m[1][0]).toBe(3);
    expect(m[1][2]).toBe(-3);
    expect(Math.max(...m.flat())).toBe(3);
  });

  it('con relleno la imagen conserva su tamaño y la identidad no la cambia', () => {
    const m = convolve2d(IMG_L, KERNELS.identidad.k, 1, 1);
    expect(m).toEqual(IMG_L);
  });

  it('maxPool 2×2 reduce a la mitad', () => {
    const m = maxPool([[1, 2, 0, 0], [3, 4, 0, 5], [0, 0, 7, 0], [0, 1, 0, 0]]);
    expect(m).toEqual([[4, 5], [1, 7]]);
  });
});

describe('Z9 · memoria', () => {
  it('con |w| < 1 una RNN olvida el primer dato; una celda con puerta f ≈ 1 lo conserva', () => {
    expect(memoryOfFirst(12, 'rnn', 0.5)).toBeLessThan(0.001);
    expect(memoryOfFirst(12, 'cell', 0.97)).toBeGreaterThan(0.6);
    expect(memoryOfFirst(12, 'cell', 0.5)).toBeLessThan(0.001);
    expect(memoryOfFirst(12, 'rnn', 2)).toBeGreaterThan(0.9); // con w > 1 el estado se satura en ±1 y «recuerda», pero es inestable
    expect(rnnTrace([1, 0, 0], 0.5)[0]).toBeCloseTo(Math.tanh(1), 12);
    expect(cellTrace([1, 0, 0], 0.9)[2]).toBeCloseTo(0.81, 12);
  });
});

describe('Z9 · sobreajuste', () => {
  it('sin regularizar el modelo grande empeora antes y más; con dropout y decaimiento la mejor época se retrasa', () => {
    const sin = overfitCurves({ capacidad: 3, dropout: false, decay: false });
    const con = overfitCurves({ capacidad: 3, dropout: true, decay: true });
    const bs = bestEpoch(sin.val);
    const bc = bestEpoch(con.val);
    expect(bc).toBeGreaterThan(bs);
    expect(sin.val[59] - sin.val[bs]).toBeGreaterThan(con.val[59] - con.val[bc]);
    expect(sin.train[59]).toBeLessThan(sin.val[59]);
  });

  it('un modelo pequeño casi no sobreajusta y la parada temprana respeta la paciencia', () => {
    const pq = overfitCurves({ capacidad: 1, dropout: false, decay: false });
    expect(pq.val[59] - Math.min(...pq.val)).toBeLessThan(0.1);
    const v = [5, 4, 3, 2.5, 2.6, 2.7, 2.8, 2.9];
    expect(earlyStop(v, 3)).toBe(6);
    expect(earlyStop([3, 2, 1], 5)).toBe(2);
  });
});
