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
