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

import { biasVariance, bestTrial, confusionAt, foldStats, gridTrials, kfoldDemo, normCdf, randomTrials, rocAuc, rocCurve } from '../iaMlLogic';

describe('Z6 · evaluación', () => {
  it('normCdf', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(-3)).toBeLessThan(0.002);
  });

  it('la matriz de confusión cuadra y la exactitud engaña con pocas positivas', () => {
    const c = confusionAt(0.9, 0.5);
    expect(c.tp + c.fp + c.fn + c.tn).toBeCloseTo(1000, 6);
    const hi = confusionAt(5, 0.05);
    expect(hi.accuracy).toBeGreaterThan(0.94);
    expect(hi.recall).toBeLessThan(0.01);
    expect(confusionAt(-1, 0.5).recall).toBeGreaterThan(confusionAt(2, 0.5).recall);
    expect(confusionAt(0, 0.05).precision).toBeLessThan(confusionAt(0, 0.5).precision);
  });

  it('ROC: monótona y con AUC coherente', () => {
    const r = rocCurve(1.8);
    for (let i = 1; i < r.length; i++) {
      expect(r[i].fpr).toBeGreaterThanOrEqual(r[i - 1].fpr - 1e-12);
      expect(r[i].tpr).toBeGreaterThanOrEqual(r[i - 1].tpr - 1e-12);
    }
    expect(rocAuc(0)).toBeCloseTo(0.5, 6);
    expect(rocAuc(3)).toBeGreaterThan(0.98);
    let area = 0;
    for (let i = 1; i < r.length; i++) area += ((r[i].fpr - r[i - 1].fpr) * (r[i].tpr + r[i - 1].tpr)) / 2;
    expect(area).toBeCloseTo(rocAuc(1.8), 2);
  });

  it('k-fold: los bloques particionan las filas', () => {
    const f = kfoldDemo(23, 5);
    expect(f.flatMap((x) => x.test).sort((a, b) => a - b)).toEqual(Array.from({ length: 23 }, (_, i) => i));
    expect(foldStats(f).std).toBeGreaterThan(0);
  });

  it('sesgo-varianza: U en test, más datos ayudan', () => {
    const lo = biasVariance(1, 30);
    const mid = biasVariance(4, 30);
    const hi = biasVariance(12, 30);
    expect(mid.test).toBeLessThan(lo.test);
    expect(mid.test).toBeLessThan(hi.test);
    expect(lo.verdict).toBe('sesgo alto');
    expect(hi.verdict).toBe('varianza alta');
    expect(biasVariance(12, 300).test).toBeLessThan(hi.test);
  });

  it('búsqueda aleatoria frente a rejilla con el mismo presupuesto', () => {
    const g = bestTrial(gridTrials(3));
    const r = bestTrial(randomTrials(9, 5));
    expect(gridTrials(3)).toHaveLength(9);
    expect(r.score).toBeGreaterThan(g.score);
  });
});

import { FILMS, cloud3, cosine, dbscan, elbowTable, ellipse2D, kmInertia, kmeansBest, kmeansSteps, moonsNoisy, pcaAngle, projVariance, recommend, silhouette } from '../iaMlLogic';

describe('Z7 · no supervisado', () => {
  it('k-means converge y reduce la inercia en cada paso de actualización', () => {
    const pts = cloud3();
    expect(pts).toHaveLength(45);
    const st = kmeansSteps(pts, 3, 1);
    expect(st[0].phase).toBe('inicio');
    expect(st[st.length - 1].phase).toBe('fin');
    const upd = st.filter((s) => s.phase === 'actualizar').map((s) => s.inertia);
    const asg = st.filter((s) => s.phase === 'asignar').map((s) => s.inertia);
    for (let i = 0; i < upd.length; i++) expect(upd[i]).toBeLessThanOrEqual(asg[i] + 1e-12);
    const best = kmeansBest(pts, 3);
    expect(kmInertia(pts, best.centers, best.labels)).toBeCloseTo(best.inertia, 9);
  });

  it('el codo y la silueta señalan k = 3', () => {
    const pts = cloud3();
    const t = elbowTable(pts, 6);
    for (let i = 1; i < t.length; i++) expect(t[i].inertia).toBeLessThanOrEqual(t[i - 1].inertia + 1e-9);
    const bestK = t.slice(1).reduce((a, b) => (b.silhouette > a.silhouette ? b : a)).k;
    expect(bestK).toBe(3);
    expect(silhouette(pts, kmeansBest(pts, 3).labels, 3)).toBeGreaterThan(0.6);
  });

  it('DBSCAN encuentra dos lunas y marca los puntos sueltos como ruido', () => {
    const pts = moonsNoisy();
    const ok = dbscan(pts, 0.08, 4);
    expect(ok.clusters).toBe(2);
    expect(ok.noise).toBeGreaterThanOrEqual(4);
    expect(dbscan(pts, 0.02, 4).clusters).toBeGreaterThanOrEqual(0);
    expect(dbscan(pts, 0.6, 4).clusters).toBe(1);
  });

  it('PCA: el primer eje es el de mayor varianza y las dos varianzas suman lo mismo', () => {
    const pts = ellipse2D();
    const a = pcaAngle(pts);
    expect(a.deg).toBeGreaterThan(20);
    expect(a.deg).toBeLessThan(50);
    expect(projVariance(pts, a.deg + 90)).toBeCloseTo(a.varTotal - projVariance(pts, a.deg), 3);
    expect(a.varMax).toBeGreaterThan(projVariance(pts, a.deg + 45));
  });

  it('el recomendador sugiere lo que gusta a los usuarios parecidos', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1, 9);
    const mine = [5, 0, 5, 0, 0, 0];
    const r = recommend(mine);
    expect(FILMS[r.scores[0].film]).toBe('Gladiator');
    expect(r.sims[0]).toBeGreaterThan(r.sims[2]);
  });
});
