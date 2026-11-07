import { ANIMALS, annSearch, chunkInfo, chunkRanges, cloud, kmeans2, rank2, score2 } from '../iaVecLogic';
import { EMB_FAMILIA, EMB_MAP, FAQ_DOCS, FAQ_SEARCH } from '../iaEmbedData';

describe('Z10 · espacio de características', () => {
  it('el vecino más cercano euclídeo y el de mayor coseno pueden no coincidir', () => {
    const q = { x: 1, y: 1 };
    const e = rank2(ANIMALS, q, 'euclidea')[0].item.name;
    const c = rank2(ANIMALS, q, 'coseno')[0].item.name;
    expect(e).toBe('tortuga');
    expect(c).toBe('caballo');
  });

  it('el coseno no depende de la longitud y el producto escalar sí', () => {
    const a = { name: 'a', x: 2, y: 4 };
    const b = { name: 'b', x: 4, y: 8 };
    const q = { x: 1, y: 2 };
    expect(score2(a, q, 'coseno')).toBeCloseTo(score2(b, q, 'coseno'), 12);
    expect(score2(b, q, 'producto')).toBeGreaterThan(score2(a, q, 'producto'));
  });
});

describe('Z10 · datos de embeddings generados', () => {
  it('hay mapas con vecinos y la búsqueda semántica gana a la de palabras en la mayoría de consultas', () => {
    expect(EMB_MAP.length).toBeGreaterThan(30);
    expect(EMB_MAP.every((p) => p.nn && p.nn.length === 4)).toBe(true);
    expect(EMB_FAMILIA.map((p) => p.w)).toContain('reina');
    const ids = FAQ_DOCS.map((d) => d.id);
    const top = (v: number[]): string => ids[v.indexOf(Math.max(...v))];
    const sem = FAQ_SEARCH.filter((s) => top(s.sem) === s.esp).length;
    const kw = FAQ_SEARCH.filter((s) => top(s.kw) === s.esp).length;
    expect(sem).toBeGreaterThan(kw);
    expect(sem).toBeGreaterThanOrEqual(6);
  });
});

describe('Z10 · búsqueda aproximada', () => {
  const pts = cloud();
  const km = kmeans2(pts, 6);
  const q = { x: 0.48, y: 0.62 };

  it('mirar más celdas nunca baja la exhaustividad y siempre cuesta más comparaciones', () => {
    const r1 = annSearch(pts, km, q, 5, 1);
    const r3 = annSearch(pts, km, q, 5, 3);
    const r6 = annSearch(pts, km, q, 5, 6);
    expect(r3.recall).toBeGreaterThanOrEqual(r1.recall);
    expect(r6.recall).toBe(1);
    expect(r1.comparisons).toBeLessThan(r3.comparisons);
    expect(r1.comparisons).toBeLessThan(r1.exactComparisons);
    expect(r6.found).toEqual(r6.exact);
  });

  it('en el borde entre grupos con una sola celda se pierde algún vecino', () => {
    const qs = [{ x: 0.5, y: 0.4 }, { x: 0.35, y: 0.5 }, { x: 0.65, y: 0.45 }, { x: 0.5, y: 0.72 }];
    expect(qs.some((p) => annSearch(pts, km, p, 8, 1).recall < 1)).toBe(true);
  });
});

describe('Z10 · chunking', () => {
  it('cubre todo el texto y respeta el solape', () => {
    const r = chunkRanges(1000, 300, 50);
    expect(r[0]).toEqual([0, 300]);
    expect(r[1][0]).toBe(250);
    expect(r[r.length - 1][1]).toBe(1000);
    expect(chunkRanges(100, 300, 50)).toEqual([[0, 100]]);
  });

  it('sin solape una respuesta que cruza el corte queda partida; con solape suficiente aparece entera', () => {
    expect(chunkInfo(1000, 300, 0, [280, 340]).cut).toBe(true);
    expect(chunkInfo(1000, 300, 100, [280, 340]).cut).toBe(false);
  });
});
