import { PySession } from '../index';
import { parseFigure } from '@/lib/figure';

const run = async (code: string) => {
  const s = new PySession({});
  const figs: string[] = [];
  const r = await s.run(code, { onFigure: (j) => figs.push(j) });
  return { r, figs };
};

describe('matplotlib (miniatura)', () => {
  test('plt.show emite una figura con sus series y su configuración', async () => {
    const { r, figs } = await run(`
import numpy as np
import matplotlib.pyplot as plt
x = np.linspace(0, 1, 5)
plt.plot(x, x ** 2, 'r--', label='cuadrado')
plt.title('Prueba'); plt.xlabel('x'); plt.ylabel('y'); plt.grid(True); plt.legend()
plt.show()
`);
    expect(r.ok).toBe(true);
    expect(figs).toHaveLength(1);
    const f = parseFigure(figs[0])!;
    expect(f.axes).toHaveLength(1);
    const ax = f.axes[0];
    expect(ax.title).toBe('Prueba');
    expect(ax.xlabel).toBe('x');
    expect(ax.grid).toBe(true);
    expect(ax.legend).toBe(true);
    expect(ax.series[0].t).toBe('line');
    expect(ax.series[0].y).toEqual([0, 0.0625, 0.25, 0.5625, 1]);
    expect(ax.series[0].ls).toBe('--');
    expect(ax.series[0].label).toBe('cuadrado');
  });

  test('subplots, histogramas y barras producen varios ejes', async () => {
    const { r, figs } = await run(`
import numpy as np
import matplotlib.pyplot as plt
np.random.seed(0)
fig, axes = plt.subplots(1, 2)
axes[0].hist(np.random.randn(100), bins=5)
axes[1].bar(['a', 'b'], [3, 4])
plt.show()
`);
    expect(r.ok).toBe(true);
    expect(figs).toHaveLength(1);
    const f = parseFigure(figs[0])!;
    expect(f.axes).toHaveLength(2);
    expect(f.axes[0].series[0].t).toBe('hist');
    expect(f.axes[1].series[0].t).toBe('bar');
  });

  test('dos plt.show() son dos figuras y el estado se reinicia', async () => {
    const { figs } = await run(`
import matplotlib.pyplot as plt
plt.plot([1, 2, 3]); plt.show()
plt.scatter([1], [2]); plt.show()
`);
    expect(figs).toHaveLength(2);
    expect(parseFigure(figs[0])!.axes[0].series[0].t).toBe('line');
    expect(parseFigure(figs[1])!.axes[0].series[0].t).toBe('scatter');
  });

  test('sin figuras, no se emite nada', async () => {
    const { r, figs } = await run('print("hola")');
    expect(r.ok).toBe(true);
    expect(figs).toHaveLength(0);
  });

  test('las figuras también llegan en el resultado', async () => {
    const s = new PySession({});
    const r = await s.run('import matplotlib.pyplot as plt\nplt.plot([1, 2])\nplt.show()\n');
    expect(r.figures).toHaveLength(1);
  });
});
