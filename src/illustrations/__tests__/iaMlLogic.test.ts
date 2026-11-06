import { HOUSE_FEATS, HOUSE_INTERCEPT, curveData, fitRegressor1D, housePredict, lassoCoefs, lrBest, lrMse, regMetrics, ridgeCoefs } from '../iaMlLogic';

describe('Z4 · regresión', () => {
  it('la recta de mínimos cuadrados tiene el menor error posible', () => {
    const best = lrBest();
    const base = lrMse(best);
    for (const dw of [-0.3, 0.3]) for (const db of [-1, 1]) expect(lrMse({ w: best.w + dw, b: best.b + db })).toBeGreaterThan(base);
    expect(best.w).toBeGreaterThan(1.3);
    expect(best.w).toBeLessThan(1.5);
  });

  it('la predicción de la casa reproduce el modelo de scikit-learn', () => {
    const p = housePredict({ superficie: 100, habitaciones: 3, antiguedad: 10, distancia: 5 });
    expect(p.total).toBeCloseTo(260.33, 1);
    expect(HOUSE_FEATS).toHaveLength(4);
    expect(housePredict({}).total).toBeGreaterThan(HOUSE_INTERCEPT);
  });

  it('un atípico dispara el RMSE mucho más que el MAE', () => {
    const calm = regMetrics(-5);
    const wild = regMetrics(60);
    expect(wild.rmse / wild.mae).toBeGreaterThan(calm.rmse / calm.mae);
    expect(wild.r2).toBeLessThan(calm.r2);
    expect(calm.r2).toBeGreaterThan(0.9);
  });

  it('Ridge encoge y Lasso anula coeficientes', () => {
    const norm = (c: number[]): number => Math.hypot(...c);
    expect(norm(ridgeCoefs(10))).toBeLessThan(norm(ridgeCoefs(0.1)));
    expect(norm(ridgeCoefs(0.1))).toBeLessThan(norm(ridgeCoefs(0)) + 1e-9);
    const big = lassoCoefs(3);
    expect(big.filter((v) => v === 0).length).toBeGreaterThanOrEqual(2);
    expect(lassoCoefs(0.01).filter((v) => v === 0).length).toBe(0);
    expect(lassoCoefs(30).every((v) => v === 0)).toBe(true);
  });

  it('el árbol profundo sobreajusta y la recta infraajusta', () => {
    const d = curveData();
    expect(d.train.length + d.test.length).toBe(36);
    const lin = fitRegressor1D('lineal', 0, d);
    const deep = fitRegressor1D('arbol', 8, d);
    const mid = fitRegressor1D('arbol', 3, d);
    expect(lin.verdict).toBe('infraajuste');
    expect(deep.verdict).toBe('sobreajuste');
    expect(mid.verdict).toBe('bien');
    expect(deep.trainRmse).toBeLessThan(mid.trainRmse);
    const knn1 = fitRegressor1D('knn', 1, d);
    expect(knn1.trainRmse).toBeCloseTo(0, 6);
    expect(fitRegressor1D('knn', 4, d).curve).toHaveLength(61);
  });
});

import { SIG_POINTS, bestThreshold, blobs2D, ensembleAccuracy, gini, giniSplit, knnGrid, majorityAccuracy, moons2D, sigmoidView, svmFit } from '../iaMlLogic';

describe('Z5 · clasificación', () => {
  it('la sigmoide y su frontera', () => {
    const v = sigmoidView(1, -3, 0.5);
    expect(v.boundary).toBeCloseTo(3, 6);
    expect(v.tp + v.fp + v.fn + v.tn).toBe(SIG_POINTS.length);
    expect(sigmoidView(1, -3, 0.2).fn).toBeLessThanOrEqual(v.fn);
    expect(sigmoidView(0, 0, 0.5).boundary).toBeNull();
  });

  it('Gini', () => {
    expect(gini(5, 5)).toBeCloseTo(0.5, 9);
    expect(gini(10, 0)).toBe(0);
    const pts = SIG_POINTS;
    const t = bestThreshold(pts);
    expect(giniSplit(pts, t).gain).toBeGreaterThan(giniSplit(pts, 0.5).gain - 1e-12);
    expect(giniSplit(pts, 100).gain).toBeCloseTo(0, 9);
  });

  it('KNN: k=1 memoriza y k grande suaviza', () => {
    const pts = moons2D();
    expect(pts).toHaveLength(44);
    expect(knnGrid(pts, 1).acc).toBe(1);
    expect(knnGrid(pts, 15).acc).toBeLessThan(1);
    expect(knnGrid(pts, 3).cells).toHaveLength(16);
  });

  it('SVM: más C = más ajuste, menos vectores de soporte', () => {
    const pts = blobs2D();
    const soft = svmFit(pts, 'lineal', 0.05, 1);
    const hard = svmFit(pts, 'lineal', 100, 1);
    expect(hard.sv.length).toBeLessThanOrEqual(soft.sv.length);
    expect(hard.acc).toBeGreaterThanOrEqual(soft.acc - 0.1);
    const rbf = svmFit(moons2D(), 'rbf', 10, 20);
    expect(rbf.acc).toBeGreaterThan(0.9);
  });

  it('el voto mejora a los modelos buenos e independientes, no a los correlados', () => {
    expect(majorityAccuracy(1, 0.7)).toBeCloseTo(0.7, 9);
    expect(majorityAccuracy(21, 0.7)).toBeGreaterThan(0.95);
    expect(majorityAccuracy(21, 0.45)).toBeLessThan(0.45);
    expect(ensembleAccuracy(21, 0.7, 1)).toBeCloseTo(0.7, 9);
    expect(ensembleAccuracy(21, 0.7, 0.5)).toBeLessThan(majorityAccuracy(21, 0.7));
  });
});
