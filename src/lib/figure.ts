/**
 * Lógica pura de las figuras de matplotlib: interpretación del JSON, límites de los datos, marcas «bonitas» de los ejes,
 * escalas y mapas de color. La pantalla (`ui/Figure.tsx`) solo dibuja lo que se calcula aquí.
 */

export interface Series {
  t: string;
  [k: string]: any;
}

export interface AxSpec {
  pos: [number, number, number, number];
  title: string;
  xlabel: string;
  ylabel: string;
  xlim: (number | null | string)[] | null;
  ylim: (number | null | string)[] | null;
  grid: boolean;
  legend: boolean;
  equal: boolean;
  off: boolean;
  xscale: 'linear' | 'log';
  yscale: 'linear' | 'log';
  xticks: number[] | null;
  xticklabels: string[] | null;
  yticks: number[] | null;
  yticklabels: string[] | null;
  series: Series[];
}

export interface FigSpec {
  w: number;
  h: number;
  title: string;
  axes: AxSpec[];
}

export function parseFigure(json: string): FigSpec | null {
  try {
    const f = JSON.parse(json) as FigSpec;
    return Array.isArray(f.axes) ? f : null;
  } catch {
    return null;
  }
}

// ───────────────────────── límites y marcas ─────────────────────────

export interface Bounds {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function dataBounds(ax: AxSpec): Bounds {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const addX = (v: unknown) => {
    if (fin(v)) {
      x0 = Math.min(x0, v);
      x1 = Math.max(x1, v);
    }
  };
  const addY = (v: unknown) => {
    if (fin(v)) {
      y0 = Math.min(y0, v);
      y1 = Math.max(y1, v);
    }
  };
  for (const s of ax.series) {
    switch (s.t) {
      case 'line':
      case 'scatter':
      case 'step':
      case 'stem':
        (s.x ?? []).forEach(addX);
        (s.y ?? []).forEach(addY);
        if (s.t === 'stem') addY(0);
        break;
      case 'bar': {
        const w = s.w ?? 0.8;
        (s.x ?? []).forEach((v: number | null, i: number) => {
          if (fin(v)) {
            addX(v - w / 2);
            addX(v + w / 2);
          }
          const base = s.bottom?.[i] ?? 0;
          addY(base);
          addY(base + (s.h?.[i] ?? 0));
        });
        break;
      }
      case 'barh': {
        const w = s.w ?? 0.8;
        (s.x ?? []).forEach((v: number | null, i: number) => {
          if (fin(v)) {
            addY(v - w / 2);
            addY(v + w / 2);
          }
          addX(0);
          addX(s.h?.[i] ?? 0);
        });
        break;
      }
      case 'hist':
        (s.edges ?? []).forEach(addX);
        addY(0);
        (s.h ?? []).forEach(addY);
        break;
      case 'image': {
        const z = s.z as number[][];
        const e = s.extent as number[] | null;
        if (e) {
          addX(e[0]);
          addX(e[1]);
          addY(e[2]);
          addY(e[3]);
        } else {
          addX(-0.5);
          addX((z[0]?.length ?? 1) - 0.5);
          addY(-0.5);
          addY(z.length - 0.5);
        }
        break;
      }
      case 'mesh':
        (s.xs ?? []).forEach(addX);
        (s.ys ?? []).forEach(addY);
        break;
      case 'band':
        (s.x ?? []).forEach(addX);
        (s.y1 ?? []).forEach(addY);
        (s.y2 ?? []).forEach(addY);
        break;
      case 'yerr':
        (s.lo ?? []).forEach(addY);
        (s.hi ?? []).forEach(addY);
        break;
      case 'text':
        addX(s.x);
        addY(s.y);
        break;
      case 'hline':
        addY(s.y);
        break;
      case 'vline':
        addX(s.x);
        break;
      case 'box':
        (s.boxes ?? []).forEach((b: any, i: number) => {
          addX(i + 0.5);
          addX(i + 1.5);
          addY(b.lo);
          addY(b.hi);
          (b.out ?? []).forEach(addY);
        });
        break;
      default:
        break;
    }
  }
  if (!Number.isFinite(x0)) {
    x0 = 0;
    x1 = 1;
  }
  if (!Number.isFinite(y0)) {
    y0 = 0;
    y1 = 1;
  }
  return { x0, x1, y0, y1 };
}

/** pasos «bonitos» (1, 2, 5 × 10ⁿ) para marcar un eje */
export function niceTicks(lo: number, hi: number, approx = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / Math.max(approx, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
  const start = Math.ceil(lo / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toFixed(12));
  return out;
}

export function fmtTick(v: number, step = 1): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-3) return v.toExponential(0).replace('e+', 'e');
  const dec = Math.max(0, -Math.floor(Math.log10(step || 1)));
  return (+v.toFixed(Math.min(dec, 6))).toString();
}

export interface Scale {
  lo: number;
  hi: number;
  log: boolean;
  map: (v: number) => number;
}

/** escala de un eje: acepta márgenes del 5 % salvo que el usuario fije los límites */
export function makeScale(lo: number, hi: number, fixed: (number | null | string)[] | null, log: boolean, pad = 0.05): Scale {
  let a = lo;
  let b = hi;
  if (fixed) {
    if (fin(fixed[0])) a = fixed[0] as number;
    if (fin(fixed[1])) b = fixed[1] as number;
  } else if (b > a) {
    const m = (b - a) * pad;
    a -= m;
    b += m;
  } else {
    a -= 0.5;
    b += 0.5;
  }
  if (log) {
    a = Math.max(a, 1e-12);
    b = Math.max(b, a * 1.0001);
    if (!fixed) {
      a = Math.pow(10, Math.floor(Math.log10(lo > 0 ? lo : 1e-3)));
      b = Math.pow(10, Math.ceil(Math.log10(hi > 0 ? hi : 1)));
      if (b <= a) b = a * 10;
    }
    const la = Math.log10(a);
    const lb = Math.log10(b);
    return { lo: a, hi: b, log: true, map: (v) => (Math.log10(Math.max(v, 1e-300)) - la) / (lb - la) };
  }
  if (fixed && fixed[2] === 'invert') return { lo: a, hi: b, log: false, map: (v) => 1 - (v - a) / (b - a) };
  return { lo: a, hi: b, log: false, map: (v) => (v - a) / (b - a) };
}

// ───────────────────────── colores ─────────────────────────

type RGB = [number, number, number];

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const STOPS: Record<string, string[]> = {
  viridis: ['#440154', '#3B528B', '#21908C', '#5DC863', '#FDE725'],
  plasma: ['#0D0887', '#7E03A8', '#CC4678', '#F89441', '#F0F921'],
  magma: ['#000004', '#51127C', '#B63679', '#FB8861', '#FCFDBF'],
  inferno: ['#000004', '#57106E', '#BC3754', '#F98E09', '#FCFFA4'],
  coolwarm: ['#3B4CC0', '#8DB0FE', '#DDDDDD', '#F4987A', '#B40426'],
  bwr: ['#0000FF', '#9999FF', '#FFFFFF', '#FF9999', '#FF0000'],
  RdBu: ['#B2182B', '#EF8A62', '#F7F7F7', '#67A9CF', '#2166AC'],
  RdYlGn: ['#D73027', '#FDAE61', '#FFFFBF', '#A6D96A', '#1A9850'],
  Blues: ['#F7FBFF', '#C6DBEF', '#6BAED6', '#2171B5', '#08306B'],
  Greens: ['#F7FCF5', '#C7E9C0', '#74C476', '#238B45', '#00441B'],
  Reds: ['#FFF5F0', '#FCBBA1', '#FB6A4A', '#CB181D', '#67000D'],
  Oranges: ['#FFF5EB', '#FDD0A2', '#FD8D3C', '#D94801', '#7F2704'],
  gray: ['#000000', '#404040', '#808080', '#C0C0C0', '#FFFFFF'],
  gray_r: ['#FFFFFF', '#C0C0C0', '#808080', '#404040', '#000000'],
  binary: ['#FFFFFF', '#C0C0C0', '#808080', '#404040', '#000000'],
  hot: ['#0B0000', '#9E0000', '#FF5A00', '#FFD200', '#FFFFFF'],
  spring: ['#FF00FF', '#FF40BF', '#FF8080', '#FFC040', '#FFFF00'],
};

const DISCRETE = ['#4C9AFF', '#FF8A3D', '#2FBF71', '#E5484D', '#A78BFA', '#B08968', '#F472B6', '#9CA3AF', '#D4C13B', '#22D3EE'];

export function cmapColor(name: string | null | undefined, t: number): string {
  const n = name ?? 'viridis';
  if (n === 'tab10' || n === 'Set1' || n === 'Set2' || n === 'Paired' || n === 'tab20') return DISCRETE[Math.round(t) % DISCRETE.length];
  const stops = (STOPS[n] ?? STOPS.viridis).map(hex);
  const u = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(u));
  const f = u - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** reduce una malla grande a lo sumo `max` × `max` celdas (promedio por bloques) para dibujarla con pocos rectángulos */
export function downsample(z: (number | null)[][], max: number): { z: (number | null)[][]; fy: number; fx: number } {
  const ny = z.length;
  const nx = z[0]?.length ?? 0;
  const fy = Math.max(1, Math.ceil(ny / max));
  const fx = Math.max(1, Math.ceil(nx / max));
  if (fy === 1 && fx === 1) return { z, fy, fx };
  const out: (number | null)[][] = [];
  for (let i = 0; i < ny; i += fy) {
    const row: (number | null)[] = [];
    for (let j = 0; j < nx; j += fx) {
      let s = 0;
      let c = 0;
      for (let a = i; a < Math.min(ny, i + fy); a++) for (let b = j; b < Math.min(nx, j + fx); b++) {
        const v = z[a][b];
        if (fin(v)) {
          s += v;
          c++;
        }
      }
      row.push(c ? s / c : null);
    }
    out.push(row);
  }
  return { z: out, fy, fx };
}

export function zRange(z: (number | null)[][], vmin?: number | null, vmax?: number | null): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of z) for (const v of r) if (fin(v)) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (!Number.isFinite(lo)) return [0, 1];
  const a = fin(vmin) ? vmin : lo;
  const b = fin(vmax) ? vmax : hi;
  return [a, b > a ? b : a + 1];
}
