import { cmapColor, dataBounds, downsample, fmtTick, makeScale, niceTicks, parseFigure, zRange, type AxSpec } from '../figure';

const ax = (series: AxSpec['series']): AxSpec => ({
  pos: [0, 0, 1, 1], title: '', xlabel: '', ylabel: '', xlim: null, ylim: null, grid: false, legend: false, equal: false, off: false,
  xscale: 'linear', yscale: 'linear', xticks: null, xticklabels: null, yticks: null, yticklabels: null, series,
});

describe('figure: interpretación', () => {
  test('parseFigure acepta figuras válidas y rechaza el resto', () => {
    expect(parseFigure('{"w":4,"h":3,"title":"","axes":[]}')).toBeTruthy();
    expect(parseFigure('no es json')).toBeNull();
    expect(parseFigure('{"w":1}')).toBeNull();
  });

  test('dataBounds recorre líneas, barras, histogramas e imágenes', () => {
    expect(dataBounds(ax([{ t: 'line', x: [1, 5, null], y: [-2, 4, 9] }]))).toEqual({ x0: 1, x1: 5, y0: -2, y1: 9 });
    const b = dataBounds(ax([{ t: 'bar', x: [0, 1], h: [3, -1], w: 0.5 }]));
    expect(b).toEqual({ x0: -0.25, x1: 1.25, y0: -1, y1: 3 });
    expect(dataBounds(ax([{ t: 'hist', edges: [0, 1, 2], h: [4, 6] }]))).toEqual({ x0: 0, x1: 2, y0: 0, y1: 6 });
    expect(dataBounds(ax([{ t: 'image', z: [[1, 2, 3], [4, 5, 6]], extent: null }]))).toEqual({ x0: -0.5, x1: 2.5, y0: -0.5, y1: 1.5 });
    expect(dataBounds(ax([]))).toEqual({ x0: 0, x1: 1, y0: 0, y1: 1 });
  });
});

describe('figure: marcas y escalas', () => {
  test('niceTicks usa pasos 1, 2, 5 × 10ⁿ', () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(-1, 1, 4)).toEqual([-1, -0.5, 0, 0.5, 1]);
    expect(niceTicks(3, 3)).toEqual([3]);
  });

  test('fmtTick evita decimales de más', () => {
    expect(fmtTick(0.2, 0.2)).toBe('0.2');
    expect(fmtTick(5, 1)).toBe('5');
    expect(fmtTick(0)).toBe('0');
    expect(fmtTick(2e7)).toBe('2e7');
  });

  test('makeScale añade margen del 5 % y respeta los límites fijados', () => {
    const s = makeScale(0, 10, null, false);
    expect(s.lo).toBeCloseTo(-0.5);
    expect(s.hi).toBeCloseTo(10.5);
    expect(s.map(-0.5)).toBeCloseTo(0);
    expect(s.map(10.5)).toBeCloseTo(1);
    const f = makeScale(0, 10, [2, 4], false);
    expect([f.lo, f.hi]).toEqual([2, 4]);
    expect(f.map(3)).toBeCloseTo(0.5);
    const flat = makeScale(5, 5, null, false);
    expect([flat.lo, flat.hi]).toEqual([4.5, 5.5]);
  });

  test('escala logarítmica a décadas completas', () => {
    const s = makeScale(3, 700, null, true);
    expect([s.lo, s.hi]).toEqual([1, 1000]);
    expect(s.map(10)).toBeCloseTo(1 / 3);
  });
});

describe('figure: colores y mallas', () => {
  test('cmapColor interpola entre las paradas del mapa', () => {
    expect(cmapColor('gray', 0)).toBe('#000000');
    expect(cmapColor('gray', 1)).toBe('#ffffff');
    expect(cmapColor('gray', 0.5)).toBe('#808080');
    expect(cmapColor(undefined, 0)).toBe('#440154');
    expect(cmapColor('mapa-raro', 1)).toBe('#fde725');
    expect(cmapColor('tab10', 1)).toBe('#FF8A3D');
  });

  test('downsample promedia por bloques', () => {
    const z = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]];
    const d = downsample(z, 2);
    expect(d.fx).toBe(2);
    expect(d.fy).toBe(2);
    expect(d.z).toEqual([[3.5, 5.5], [11.5, 13.5]]);
    expect(downsample(z, 8).z).toBe(z);
  });

  test('zRange usa los extremos o vmin/vmax', () => {
    expect(zRange([[1, 5], [3, null]])).toEqual([1, 5]);
    expect(zRange([[1, 5]], 0, 10)).toEqual([0, 10]);
    expect(zRange([[null]])).toEqual([0, 1]);
    expect(zRange([[2, 2]])).toEqual([2, 3]);
  });
});
