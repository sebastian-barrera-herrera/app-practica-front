import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { cmapColor, dataBounds, downsample, fmtTick, makeScale, niceTicks, parseFigure, zRange, type AxSpec, type FigSpec, type Scale } from '@/lib/figure';
import { T } from './Text';
import { colors, darkColors, fonts, radius } from './theme';

const MAX_CELLS = 56;

const dash = (ls?: string): string | undefined => (ls === '--' ? '6,4' : ls === ':' ? '2,3' : ls === '-.' ? '6,3,1.5,3' : undefined);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function AxesView({ ax, box, ink, grid, bg }: { ax: AxSpec; box: Box; ink: string; grid: string; bg: string }) {
  const fs = Math.max(9, Math.min(12, box.w / 28));
  const left = ax.off ? 6 : 8 + fs * 3.4;
  const bottom = ax.off ? 6 : fs * 2.6 + (ax.xlabel ? fs * 1.3 : 0);
  const top = ax.title ? fs * 2 : 8;
  const right = 8;
  let px = box.x + left;
  let py = box.y + top;
  let pw = Math.max(20, box.w - left - right);
  let ph = Math.max(20, box.h - top - bottom);

  const b = useMemo(() => dataBounds(ax), [ax]);
  const sx = useMemo(() => makeScale(b.x0, b.x1, ax.xlim, ax.xscale === 'log', ax.series.some((s) => s.t === 'image' || s.t === 'mesh') ? 0 : 0.05), [b, ax]);
  const sy = useMemo(() => makeScale(b.y0, b.y1, ax.ylim, ax.yscale === 'log', ax.series.some((s) => s.t === 'image' || s.t === 'mesh') ? 0 : 0.05), [b, ax]);

  if (ax.equal && !ax.off) {
    const rx = (sx.hi - sx.lo) / pw;
    const ry = (sy.hi - sy.lo) / ph;
    if (ry > rx) {
      const nw = (sx.hi - sx.lo) / ry;
      px += (pw - nw) / 2;
      pw = nw;
    } else if (rx > ry) {
      const nh = (sy.hi - sy.lo) / rx;
      py += (ph - nh) / 2;
      ph = nh;
    }
  }

  const X = (v: number) => px + sx.map(v) * pw;
  const Y = (v: number) => py + (1 - sy.map(v)) * ph;
  const clampX = (v: number) => Math.min(px + pw, Math.max(px, v));
  const clampY = (v: number) => Math.min(py + ph, Math.max(py, v));

  const xt = ax.xticks ?? (sx.log ? logTicks(sx) : niceTicks(sx.lo, sx.hi, Math.max(3, Math.floor(pw / 56))));
  const yt = ax.yticks ?? (sy.log ? logTicks(sy) : niceTicks(sy.lo, sy.hi, Math.max(3, Math.floor(ph / 40))));
  const xstep = xt.length > 1 ? xt[1] - xt[0] : 1;
  const ystep = yt.length > 1 ? yt[1] - yt[0] : 1;

  const path = (xs: (number | null)[], ys: (number | null)[], step = false): string => {
    let d = '';
    let pen = false;
    let lx = 0;
    let ly = 0;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i];
      const y = ys[i];
      if (!num(x) || !num(y)) {
        pen = false;
        continue;
      }
      const cx = X(x);
      const cy = Y(y);
      if (!pen) d += `M${cx.toFixed(1)} ${cy.toFixed(1)}`;
      else if (step) d += `L${cx.toFixed(1)} ${ly.toFixed(1)}L${cx.toFixed(1)} ${cy.toFixed(1)}`;
      else d += `L${cx.toFixed(1)} ${cy.toFixed(1)}`;
      pen = true;
      lx = cx;
      ly = cy;
    }
    void lx;
    return d;
  };

  const legendItems = ax.legend ? ax.series.filter((s) => s.label) : [];

  return (
    <G>
      {ax.title ? (
        <SvgText x={box.x + box.w / 2} y={box.y + fs * 1.3} fontSize={fs + 1} fontWeight="bold" fill={ink} textAnchor="middle" fontFamily={fonts.bold}>{ax.title}</SvgText>
      ) : null}
      {!ax.off && (
        <>
          <Rect x={px} y={py} width={pw} height={ph} fill="none" stroke={grid} strokeWidth={1} />
          {xt.map((v, i) =>
            sx.map(v) < -0.001 || sx.map(v) > 1.001 ? null : (
              <G key={`x${i}`}>
                {ax.grid ? <Line x1={X(v)} x2={X(v)} y1={py} y2={py + ph} stroke={grid} strokeWidth={0.8} /> : null}
                <Line x1={X(v)} x2={X(v)} y1={py + ph} y2={py + ph + 3} stroke={ink} strokeWidth={1} />
                <SvgText x={X(v)} y={py + ph + fs + 4} fontSize={fs} fill={ink} textAnchor="middle" fontFamily={fonts.mono}>{ax.xticklabels?.[i] ?? fmtTick(v, xstep)}</SvgText>
              </G>
            ),
          )}
          {yt.map((v, i) =>
            sy.map(v) < -0.001 || sy.map(v) > 1.001 ? null : (
              <G key={`y${i}`}>
                {ax.grid ? <Line x1={px} x2={px + pw} y1={Y(v)} y2={Y(v)} stroke={grid} strokeWidth={0.8} /> : null}
                <Line x1={px - 3} x2={px} y1={Y(v)} y2={Y(v)} stroke={ink} strokeWidth={1} />
                <SvgText x={px - 5} y={Y(v) + fs / 3} fontSize={fs} fill={ink} textAnchor="end" fontFamily={fonts.mono}>{ax.yticklabels?.[i] ?? fmtTick(v, ystep)}</SvgText>
              </G>
            ),
          )}
          {ax.xlabel ? <SvgText x={px + pw / 2} y={box.y + box.h - 4} fontSize={fs} fill={ink} textAnchor="middle" fontFamily={fonts.regular}>{ax.xlabel}</SvgText> : null}
          {ax.ylabel ? (
            <SvgText x={box.x + fs} y={py + ph / 2} fontSize={fs} fill={ink} textAnchor="middle" fontFamily={fonts.regular} transform={`rotate(-90 ${box.x + fs} ${py + ph / 2})`}>{ax.ylabel}</SvgText>
          ) : null}
        </>
      )}
      {ax.series.map((s, k) => {
        switch (s.t) {
          case 'line':
          case 'step': {
            const d = path(s.x ?? [], s.y ?? [], s.t === 'step');
            return (
              <G key={k}>
                {s.ls !== '' && d ? <Path d={d} fill="none" stroke={s.color} strokeWidth={s.lw ?? 2} strokeDasharray={dash(s.ls)} strokeLinejoin="round" strokeLinecap="round" opacity={s.alpha ?? 1} /> : null}
                {s.marker ? (s.x ?? []).map((x: number | null, i: number) => (num(x) && num(s.y?.[i]) ? <Circle key={i} cx={X(x)} cy={Y(s.y[i])} r={(s.ms ?? 5) / 2.2} fill={s.color} /> : null)) : null}
              </G>
            );
          }
          case 'scatter': {
            const xs: (number | null)[] = s.x ?? [];
            const cs: number[] | undefined = s.c;
            let lo = 0;
            let hi = 1;
            if (cs) {
              const f = cs.filter(num);
              lo = num(s.vmin) ? s.vmin : Math.min(...f);
              hi = num(s.vmax) ? s.vmax : Math.max(...f);
              if (!(hi > lo)) hi = lo + 1;
            }
            const disc = s.cmap === 'tab10' || s.cmap === 'Set1' || s.cmap === 'Set2' || s.cmap === 'Paired';
            return (
              <G key={k} opacity={s.alpha ?? 0.9}>
                {xs.map((x, i) => {
                  const y = s.y?.[i];
                  if (!num(x) || !num(y)) return null;
                  const col = cs ? cmapColor(s.cmap, disc ? cs[i] : (cs[i] - lo) / (hi - lo)) : s.color;
                  const r = Math.max(1.8, Math.sqrt(Array.isArray(s.s) ? s.s[i] ?? 36 : s.s ?? 36) / 2);
                  return <Circle key={i} cx={X(x)} cy={Y(y)} r={r} fill={col} stroke={bg} strokeWidth={0.4} />;
                })}
              </G>
            );
          }
          case 'bar':
          case 'barh': {
            const horiz = s.t === 'barh';
            const w = s.w ?? 0.8;
            return (
              <G key={k} opacity={s.alpha ?? 1}>
                {(s.x ?? []).map((c: number | null, i: number) => {
                  if (!num(c)) return null;
                  const base = s.bottom?.[i] ?? 0;
                  const h = s.h?.[i] ?? 0;
                  if (horiz) {
                    const x0 = clampX(X(Math.min(0, h)));
                    const x1 = clampX(X(Math.max(0, h)));
                    return <Rect key={i} x={x0} y={Y(c + w / 2)} width={Math.max(0.5, x1 - x0)} height={Math.max(0.5, Y(c - w / 2) - Y(c + w / 2))} fill={s.color} />;
                  }
                  const y0 = clampY(Y(base + Math.max(0, h)));
                  const y1 = clampY(Y(base + Math.min(0, h)));
                  return <Rect key={i} x={X(c - w / 2)} y={y0} width={Math.max(0.5, X(c + w / 2) - X(c - w / 2))} height={Math.max(0.5, y1 - y0)} fill={s.color} />;
                })}
              </G>
            );
          }
          case 'hist':
            return (
              <G key={k} opacity={s.alpha ?? 0.85}>
                {(s.h ?? []).map((h: number, i: number) => {
                  const x0 = X(s.edges[i]);
                  const x1 = X(s.edges[i + 1]);
                  const y = clampY(Y(h));
                  return <Rect key={i} x={x0} y={y} width={Math.max(0.5, x1 - x0 - 1)} height={Math.max(0.5, clampY(Y(0)) - y)} fill={s.color} />;
                })}
              </G>
            );
          case 'image':
          case 'mesh': {
            const { z, fy, fx } = downsample(s.z, MAX_CELLS);
            const [lo, hi] = zRange(z, s.vmin, s.vmax);
            const ny = z.length;
            const nx = z[0]?.length ?? 0;
            const disc = s.t === 'mesh' && false;
            const cells: React.ReactNode[] = [];
            for (let i = 0; i < ny; i++) {
              for (let j = 0; j < nx; j++) {
                const v = z[i][j];
                if (!num(v)) continue;
                let x0: number;
                let x1: number;
                let y0: number;
                let y1: number;
                if (s.t === 'image') {
                  const e = s.extent as number[] | null;
                  const ex0 = e ? e[0] : -0.5;
                  const ex1 = e ? e[1] : (s.z[0]?.length ?? 1) - 0.5;
                  const ey0 = e ? e[2] : (s.z.length ?? 1) - 0.5;
                  const ey1 = e ? e[3] : -0.5;
                  const cw = (ex1 - ex0) / (s.z[0]?.length ?? 1);
                  const ch = (ey1 - ey0) / (s.z.length ?? 1);
                  x0 = ex0 + j * fx * cw;
                  x1 = ex0 + Math.min((j + 1) * fx, s.z[0].length) * cw;
                  y0 = ey0 + i * fy * ch;
                  y1 = ey0 + Math.min((i + 1) * fy, s.z.length) * ch;
                } else {
                  const xs: number[] = s.xs;
                  const ys: number[] = s.ys;
                  const jx = Math.min(xs.length - 1, j * fx);
                  const jy = Math.min(ys.length - 1, i * fy);
                  const nxj = Math.min(xs.length - 1, jx + fx);
                  const nyi = Math.min(ys.length - 1, jy + fy);
                  const dx = (xs[Math.min(xs.length - 1, jx + 1)] - xs[jx]) / 2 || 0.5;
                  const dy = (ys[Math.min(ys.length - 1, jy + 1)] - ys[jy]) / 2 || 0.5;
                  x0 = xs[jx] - dx;
                  x1 = xs[nxj] + dx * (nxj === jx ? 1 : 1);
                  y0 = ys[jy] - dy;
                  y1 = ys[nyi] + dy;
                }
                const ax0 = Math.min(X(x0), X(x1));
                const ax1 = Math.max(X(x0), X(x1));
                const ay0 = Math.min(Y(y0), Y(y1));
                const ay1 = Math.max(Y(y0), Y(y1));
                cells.push(<Rect key={`${i}-${j}`} x={clampX(ax0)} y={clampY(ay0)} width={Math.max(0.6, clampX(ax1) - clampX(ax0) + 0.4)} height={Math.max(0.6, clampY(ay1) - clampY(ay0) + 0.4)} fill={cmapColor(s.cmap, disc ? v : (v - lo) / (hi - lo))} opacity={s.alpha ?? 1} />);
              }
            }
            return <G key={k}>{cells}</G>;
          }
          case 'band': {
            const xs: (number | null)[] = s.x ?? [];
            const top = path(xs, s.y1 ?? []);
            const bot = path([...xs].reverse(), [...(s.y2 ?? [])].reverse()).replace(/^M/, 'L');
            return top && bot ? <Path key={k} d={`${top}${bot}Z`} fill={s.color} opacity={s.alpha ?? 0.3} /> : null;
          }
          case 'hline':
            return <Line key={k} x1={px} x2={px + pw} y1={Y(s.y as number)} y2={Y(s.y as number)} stroke={s.color} strokeWidth={s.lw ?? 1.5} strokeDasharray={dash(s.ls)} />;
          case 'vline':
            return <Line key={k} x1={X(s.x as number)} x2={X(s.x as number)} y1={py} y2={py + ph} stroke={s.color} strokeWidth={s.lw ?? 1.5} strokeDasharray={dash(s.ls)} />;
          case 'text':
            return <SvgText key={k} x={X(s.x as number)} y={Y(s.y as number)} fontSize={s.fs ?? fs} fill={s.color ?? ink} fontFamily={fonts.regular}>{s.s}</SvgText>;
          case 'yerr':
            return (
              <G key={k}>
                {(s.x ?? []).map((x: number | null, i: number) => (num(x) && num(s.lo?.[i]) && num(s.hi?.[i]) ? <Line key={i} x1={X(x)} x2={X(x)} y1={Y(s.lo[i])} y2={Y(s.hi[i])} stroke={s.color} strokeWidth={1.4} /> : null))}
              </G>
            );
          case 'stem':
            return (
              <G key={k}>
                {(s.x ?? []).map((x: number | null, i: number) => (num(x) && num(s.y?.[i]) ? (
                  <G key={i}>
                    <Line x1={X(x)} x2={X(x)} y1={Y(0)} y2={Y(s.y[i])} stroke={s.color} strokeWidth={1.6} />
                    <Circle cx={X(x)} cy={Y(s.y[i])} r={3} fill={s.color} />
                  </G>
                ) : null))}
              </G>
            );
          case 'box':
            return (
              <G key={k}>
                {(s.boxes ?? []).map((bx: any, i: number) => {
                  const c = i + 1;
                  return (
                    <G key={i}>
                      <Line x1={X(c)} x2={X(c)} y1={Y(bx.lo)} y2={Y(bx.q1)} stroke={ink} strokeWidth={1.2} />
                      <Line x1={X(c)} x2={X(c)} y1={Y(bx.q3)} y2={Y(bx.hi)} stroke={ink} strokeWidth={1.2} />
                      <Rect x={X(c - 0.25)} y={Y(bx.q3)} width={X(c + 0.25) - X(c - 0.25)} height={Math.max(1, Y(bx.q1) - Y(bx.q3))} fill={s.color} opacity={0.5} stroke={ink} strokeWidth={1.2} />
                      <Line x1={X(c - 0.25)} x2={X(c + 0.25)} y1={Y(bx.med)} y2={Y(bx.med)} stroke={ink} strokeWidth={2} />
                      {(bx.out ?? []).map((o: number, j: number) => <Circle key={j} cx={X(c)} cy={Y(o)} r={2.5} fill="none" stroke={ink} strokeWidth={1} />)}
                    </G>
                  );
                })}
              </G>
            );
          case 'pie': {
            const cx = px + pw / 2;
            const cy = py + ph / 2;
            const r = Math.min(pw, ph) / 2 - 4;
            let a0 = -Math.PI / 2;
            return (
              <G key={k}>
                {(s.v as number[]).map((v, i) => {
                  const frac = s.tot > 0 ? v / s.tot : 0;
                  const a1 = a0 + frac * Math.PI * 2;
                  const large = a1 - a0 > Math.PI ? 1 : 0;
                  const d = `M${cx} ${cy}L${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)}A${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}Z`;
                  const mid = (a0 + a1) / 2;
                  const label = s.labels?.[i];
                  const out = (
                    <G key={i}>
                      <Path d={d} fill={s.colors[i]} stroke={bg} strokeWidth={1.5} />
                      {s.pct && frac > 0.04 ? <SvgText x={cx + r * 0.62 * Math.cos(mid)} y={cy + r * 0.62 * Math.sin(mid) + 3} fontSize={fs} fill="#0B0B14" textAnchor="middle" fontFamily={fonts.monoBold}>{Math.round(frac * 100)}%</SvgText> : null}
                      {label ? <SvgText x={cx + (r + 4) * Math.cos(mid)} y={cy + (r + 4) * Math.sin(mid) + 3} fontSize={fs} fill={ink} textAnchor={Math.cos(mid) >= 0 ? 'start' : 'end'} fontFamily={fonts.regular}>{label}</SvgText> : null}
                    </G>
                  );
                  a0 = a1;
                  return out;
                })}
              </G>
            );
          }
          default:
            return null;
        }
      })}
      {legendItems.length > 0 && (
        <G>
          <Rect x={px + pw - 8 - Math.max(...legendItems.map((s) => String(s.label).length)) * fs * 0.62 - 24} y={py + 6} width={Math.max(...legendItems.map((s) => String(s.label).length)) * fs * 0.62 + 24} height={legendItems.length * (fs + 6) + 6} rx={5} fill={bg} opacity={0.82} stroke={grid} strokeWidth={0.8} />
          {legendItems.map((s, i) => {
            const y = py + 6 + 6 + i * (fs + 6) + fs / 2;
            const x0 = px + pw - 8 - Math.max(...legendItems.map((q) => String(q.label).length)) * fs * 0.62 - 18;
            const col = s.color ?? DEFAULT_LEGEND;
            return (
              <G key={i}>
                {s.t === 'scatter' || s.t === 'bar' || s.t === 'hist' ? <Rect x={x0} y={y - 4} width={10} height={8} fill={col} /> : <Line x1={x0} x2={x0 + 12} y1={y} y2={y} stroke={col} strokeWidth={2.4} strokeDasharray={dash(s.ls)} />}
                <SvgText x={x0 + 16} y={y + fs / 3} fontSize={fs} fill={ink} fontFamily={fonts.regular}>{s.label}</SvgText>
              </G>
            );
          })}
        </G>
      )}
    </G>
  );
}

const DEFAULT_LEGEND = '#9CA3AF';

function logTicks(s: Scale): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(s.lo)); e <= Math.ceil(Math.log10(s.hi)); e++) out.push(Math.pow(10, e));
  return out.filter((v) => v >= s.lo * 0.999 && v <= s.hi * 1.001);
}

/** Dibuja una figura de matplotlib (el JSON que emite `plt.show()`). */
export function FigureView({ json, dark = false }: { json: string; dark?: boolean }) {
  const spec: FigSpec | null = useMemo(() => parseFigure(json), [json]);
  const [w, setW] = useState(300);
  if (!spec) return null;
  const rows = Math.max(1, ...spec.axes.map((a) => a.pos[2]));
  const cols = Math.max(1, ...spec.axes.map((a) => a.pos[3]));
  const aspect = Math.min(1.1, Math.max(0.45, spec.h / spec.w));
  const baseH = Math.round(w * aspect);
  const h = Math.round(baseH * (rows > 1 ? Math.min(rows, 3) * 0.78 + 0.22 : 1) * (cols > 2 ? 0.8 : 1));
  const top = spec.title ? 22 : 0;
  const pal = dark ? darkColors : colors;
  const ink = pal.dim;
  const grid = pal.line;
  const bg = pal.card;
  return (
    <View onLayout={(e) => setW(Math.max(160, e.nativeEvent.layout.width))} style={{ backgroundColor: bg, borderRadius: radius.md, borderWidth: 1, borderColor: grid, overflow: 'hidden' }}>
      {spec.title ? <T v="label" center color={ink} style={{ paddingTop: 6 }}>{spec.title}</T> : null}
      <Svg width={w} height={h + top} viewBox={`0 0 ${w} ${h}`}>
        {spec.axes.map((ax, i) => {
          const [r, c, nr, nc] = ax.pos;
          const bw = w / nc;
          const bh = h / nr;
          return <AxesView key={i} ax={ax} box={{ x: c * bw, y: r * bh, w: bw, h: bh }} ink={ink} grid={grid} bg={bg} />;
        })}
      </Svg>
    </View>
  );
}
