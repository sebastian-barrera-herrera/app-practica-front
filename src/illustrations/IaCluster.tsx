/** Ilustraciones de la zona 7 del curso de IA: k-means, codo y silueta, DBSCAN, PCA y un recomendador por similitud. */
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { tap } from '@/lib/haptics';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { FILMS, RATINGS, cloud3, dbscan, elbowTable, ellipse2D, kmeansBest, kmeansSteps, moonsNoisy, pcaAngle, projVariance, recommend } from './iaMlLogic';
import { Callout, Explain, Frame, Meter, Pill, Stepper } from './iaui';

const Btn = ({ label, onPress, color, disabled }: { label: string; onPress: () => void; color: string; disabled?: boolean }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={() => { tap(); onPress(); }} style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: color, alignSelf: 'flex-start', opacity: disabled ? 0.4 : 1 }}>
    <T bold color="#0B0B14">{label}</T>
  </Pressable>
);

const palette = (): string[] => [colors.cyan, colors.amber, colors.rose, colors.green, colors.violet, colors.mint];

// ───────────────────────── k-means paso a paso ─────────────────────────

export function KMeansSteps() {
  const pts = useMemo(() => cloud3(), []);
  const [k, setK] = useState(3);
  const [seed, setSeed] = useState(1);
  const [i, setI] = useState(0);
  const steps = useMemo(() => kmeansSteps(pts, k, seed), [pts, k, seed]);
  const best = useMemo(() => kmeansBest(pts, k), [pts, k]);
  const idx = Math.min(i, steps.length - 1);
  const st = steps[idx];
  const pal = palette();
  const done = st.phase === 'fin';
  const bad = done && st.inertia > best.inertia * 1.3;
  const note: Record<string, string> = {
    inicio: 'Se eligen k puntos al azar como centros iniciales.',
    asignar: 'Cada punto se pinta del color del centro más cercano.',
    actualizar: 'Cada centro se mueve a la media de los puntos de su color.',
    fin: 'Los centros ya no se mueven: el algoritmo ha convergido.',
  };
  return (
    <Frame>
      <Svg width="100%" height={220} viewBox="0 0 300 220">
        <Rect x={0} y={0} width={300} height={220} fill="none" stroke={colors.line} />
        {pts.map((p, n) => <Circle key={n} cx={p.x * 300} cy={(1 - p.y) * 220} r={4.2} fill={st.phase === 'inicio' ? colors.faint : pal[st.labels[n] % pal.length]} />)}
        {st.centers.map((c, n) => {
          const cx = c.x * 300;
          const cy = (1 - c.y) * 220;
          return <Polygon key={n} points={`${cx},${cy - 9} ${cx + 8},${cy + 6} ${cx - 8},${cy + 6}`} fill={pal[n % pal.length]} stroke={colors.text} strokeWidth={2} />;
        })}
      </Svg>
      <Stepper label="Número de grupos (k)" value={k} min={2} max={5} onChange={(v) => { setK(v); setI(0); }} />
      <Stepper label="Inicio aleatorio (semilla)" value={seed} min={1} max={8} onChange={(v) => { setSeed(v); setI(0); }} />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Btn label={done ? '↺ Reiniciar' : '▶ Siguiente paso'} color={done ? colors.violet : colors.green} onPress={() => setI(done ? 0 : idx + 1)} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`paso ${idx + 1}/${steps.length}`} color={colors.dim} />
        <Pill text={`inercia ${st.inertia.toFixed(3)}`} color={done ? (bad ? colors.rose : colors.green) : colors.cyan} solid />
        <Pill text={`mejor posible ${best.inertia.toFixed(3)}`} color={colors.dim} />
      </View>
      <Explain k={`${idx}-${seed}-${k}`} title={st.phase === 'asignar' ? '1 · Asignar' : st.phase === 'actualizar' ? '2 · Actualizar' : st.phase === 'inicio' ? 'Inicio' : bad ? '⚠️ Óptimo local' : '✅ Convergido'} color={bad ? colors.rose : colors.green}>
        {bad ? <>Con este inicio el algoritmo se quedó en una solución <T v="small" bold>peor</T> (inercia {st.inertia.toFixed(2)} frente a {best.inertia.toFixed(2)}). Por eso <T v="small" bold>K-means se ejecuta varias veces</T> con inicios distintos (<T v="small" bold>n_init</T>) y se queda con la mejor.</> : note[st.phase]}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── codo y silueta ─────────────────────────

export function ElbowDemo() {
  const pts = useMemo(() => cloud3(), []);
  const table = useMemo(() => elbowTable(pts, 7), [pts]);
  const [k, setK] = useState(3);
  const row = table[k - 1];
  const bestSil = table.slice(1).reduce((a, b) => (b.silhouette > a.silhouette ? b : a));
  const W = 300;
  const H = 130;
  const X = (i: number): number => 28 + (i / 6) * (W - 48);
  const maxIn = table[0].inertia;
  const Yi = (v: number): number => H - 22 - (v / maxIn) * (H - 40);
  const Ys = (v: number): number => H - 22 - Math.max(0, v) * (H - 40);
  const pathIn = table.map((r, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Yi(r.inertia).toFixed(1)}`).join(' ');
  const best = useMemo(() => kmeansBest(pts, k), [pts, k]);
  const pal = palette();
  return (
    <Frame>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line x1={24} x2={W - 8} y1={H - 22} y2={H - 22} stroke={colors.line} />
        {table.map((r, i) => <Rect key={r.k} x={X(i) - 7} y={Ys(r.silhouette)} width={14} height={Math.max(1, H - 22 - Ys(r.silhouette))} fill={r.k === k ? colors.green : colors.green + '55'} />)}
        <Path d={pathIn} stroke={colors.violet} strokeWidth={3} fill="none" />
        {table.map((r, i) => <Circle key={r.k} cx={X(i)} cy={Yi(r.inertia)} r={r.k === k ? 6 : 3.5} fill={colors.violet} stroke={colors.bg} strokeWidth={1.5} />)}
        {table.map((r, i) => <SvgText key={r.k} x={X(i) - 3} y={H - 8} fontSize={10} fill={colors.dim} fontFamily={fonts.mono}>{r.k}</SvgText>)}
        <SvgText x={28} y={12} fontSize={10} fill={colors.violet} fontFamily={fonts.mono}>— inercia</SvgText>
        <SvgText x={W - 110} y={12} fontSize={10} fill={colors.green} fontFamily={fonts.mono}>▮ silueta</SvgText>
      </Svg>
      <Stepper label="Número de grupos (k)" value={k} min={1} max={7} onChange={setK} />
      <Svg width="100%" height={140} viewBox="0 0 300 220">
        {pts.map((p, n) => <Circle key={n} cx={p.x * 300} cy={(1 - p.y) * 220} r={5} fill={pal[best.labels[n] % pal.length]} />)}
      </Svg>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`inercia ${row.inertia.toFixed(2)}`} color={colors.violet} />
        <Pill text={`silueta ${row.silhouette.toFixed(2)}`} color={row.silhouette > 0.6 ? colors.green : colors.amber} solid />
      </View>
      <Callout color={colors.green}>
        La <T v="small" bold>inercia</T> siempre baja al subir k (con k = número de puntos valdría 0), así que se busca el <T v="small" bold>codo</T>: donde deja de bajar deprisa. Aquí está en k = 3. La <T v="small" bold>silueta</T> mide si los puntos están más cerca de su grupo que de los demás (de −1 a 1) y tiene su máximo en k = {bestSil.k}.
      </Callout>
    </Frame>
  );
}

// ───────────────────────── DBSCAN ─────────────────────────

export function DbscanDemo() {
  const pts = useMemo(() => moonsNoisy(), []);
  const [eps, setEps] = useState(0.08);
  const [ms, setMs] = useState(4);
  const res = useMemo(() => dbscan(pts, eps, ms), [pts, eps, ms]);
  const pal = palette();
  const verdict = res.clusters === 2 && res.noise <= 8 ? 'ok' : res.clusters <= 1 ? 'junto' : 'trozos';
  const col = verdict === 'ok' ? colors.green : colors.amber;
  return (
    <Frame>
      <Svg width="100%" height={220} viewBox="0 0 300 220">
        <Rect x={0} y={0} width={300} height={220} fill="none" stroke={colors.line} />
        {pts.map((p, n) => {
          const cx = p.x * 300;
          const cy = (1 - p.y) * 220;
          return res.labels[n] === -1
            ? <Path key={n} d={`M${cx - 4},${cy - 4} L${cx + 4},${cy + 4} M${cx + 4},${cy - 4} L${cx - 4},${cy + 4}`} stroke={colors.dim} strokeWidth={2} />
            : <Circle key={n} cx={cx} cy={cy} r={res.core[n] ? 5 : 3.2} fill={pal[res.labels[n] % pal.length]} stroke={colors.bg} strokeWidth={1} />;
        })}
        <Circle cx={30} cy={196} r={eps * 300} fill="none" stroke={colors.text} strokeDasharray="3 3" strokeWidth={1} />
      </Svg>
      <Stepper label="Radio ε (vecindad)" value={eps} min={0.02} max={0.2} step={0.01} onChange={(v) => setEps(Math.round(v * 100) / 100)} />
      <Stepper label="Vecinos mínimos (min_samples)" value={ms} min={2} max={8} onChange={setMs} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`${res.clusters} grupos`} color={col} solid />
        <Pill text={`${res.noise} puntos de ruido ✕`} color={colors.dim} />
      </View>
      <Callout color={col}>
        {verdict === 'ok' ? <>DBSCAN separa las dos lunas (formas que K-means no sabría trazar) y deja los puntos sueltos como <T v="small" bold>ruido</T>. Los puntos grandes son «núcleo» (tienen suficientes vecinos); los pequeños, «frontera».</> : verdict === 'junto' ? <>Con un radio tan grande las dos lunas se funden en un solo grupo.</> : <>Con un radio tan pequeño casi nadie tiene vecinos suficientes y los grupos se rompen en trozos o todo es ruido.</>} La circunferencia discontinua muestra el tamaño de ε.
      </Callout>
    </Frame>
  );
}

// ───────────────────────── PCA ─────────────────────────

export function PcaAxesDemo() {
  const pts = useMemo(() => ellipse2D(), []);
  const best = useMemo(() => pcaAngle(pts), [pts]);
  const [deg, setDeg] = useState(90);
  const v = projVariance(pts, deg);
  const share = v / best.varTotal;
  const a = (deg * Math.PI) / 180;
  const S = 30;
  const cx = 150;
  const cy = 110;
  const bestShare = best.varMax / best.varTotal;
  const col = share > bestShare - 0.01 ? colors.green : share > 0.55 ? colors.amber : colors.rose;
  return (
    <Frame>
      <Svg width="100%" height={220} viewBox="0 0 300 220">
        <Line x1={cx - Math.cos(a) * 140} y1={cy + Math.sin(a) * 140} x2={cx + Math.cos(a) * 140} y2={cy - Math.sin(a) * 140} stroke={col} strokeWidth={2.5} />
        {pts.map((p, n) => {
          const t = p.x * Math.cos(a) + p.y * Math.sin(a);
          const qx = cx + t * Math.cos(a) * S;
          const qy = cy - t * Math.sin(a) * S;
          return (
            <React.Fragment key={n}>
              <Line x1={cx + p.x * S} y1={cy - p.y * S} x2={qx} y2={qy} stroke={colors.line} strokeWidth={1} />
              <Circle cx={cx + p.x * S} cy={cy - p.y * S} r={3} fill={colors.violet} />
              <Circle cx={qx} cy={qy} r={2.6} fill={col} />
            </React.Fragment>
          );
        })}
      </Svg>
      <Stepper label="Ángulo del eje" value={deg} min={0} max={165} step={15} unit="°" onChange={setDeg} />
      <Meter label="Varianza que conserva este eje" value={share} color={col} />
      <Btn label="⚡ Mejor eje (primer componente)" color={colors.green} onPress={() => setDeg(Math.round(best.deg / 15) * 15)} />
      <Callout color={col}>
        Los puntos violeta son los datos y los del eje son su <T v="small" bold>proyección</T> en una sola dimensión. <T v="small" bold>PCA</T> busca el eje que conserva la mayor varianza (aquí hacia {best.deg.toFixed(0)}°, con el {Math.round(bestShare * 100)} % de la información): resumir 2 columnas en 1 perdiendo lo mínimo. El segundo componente es perpendicular al primero.
      </Callout>
    </Frame>
  );
}

// ───────────────────────── recomendador ─────────────────────────

export function RecommenderDemo() {
  const [mine, setMine] = useState<number[]>([5, 0, 5, 0, 0, 0]);
  const rec = useMemo(() => recommend(mine), [mine]);
  const names = ['Ana', 'Beto', 'Carla', 'Dani', 'Elena'];
  const cycle = (f: number): void => setMine((m) => m.map((v, i) => (i === f ? (v === 0 ? 5 : v === 5 ? 1 : 0) : v)));
  const maxSim = Math.max(...rec.sims, 0.01);
  return (
    <Frame>
      <T v="label" color={colors.dim}>Toca una película para cambiar tu valoración: sin ver → 👍 → 👎</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {FILMS.map((f, i) => {
          const v = mine[i];
          const c = v === 5 ? colors.green : v === 1 ? colors.rose : colors.faint;
          return (
            <Pressable key={f} accessibilityRole="button" accessibilityLabel={`${f}: ${v === 5 ? 'me gustó' : v === 1 ? 'no me gustó' : 'sin ver'}`} onPress={() => { tap(); cycle(i); }} style={{ minHeight: 44, minWidth: 92, paddingHorizontal: 10, borderRadius: radius.md, borderWidth: 1.5, borderColor: c, backgroundColor: c + '22', alignItems: 'center', justifyContent: 'center' }}>
              <T v="small" bold color={colors.text}>{f}</T>
              <T v="tiny" color={c}>{v === 5 ? '👍 me gustó' : v === 1 ? '👎 no me gustó' : 'sin ver'}</T>
            </Pressable>
          );
        })}
      </View>
      <View style={{ gap: 6 }}>
        <T v="label" color={colors.dim}>Parecido contigo (similitud coseno)</T>
        {rec.sims.map((s, u) => <Meter key={u} label={`${names[u]}: ${RATINGS[u].map((r) => r || '·').join(' ')}`} value={s / maxSim} color={colors.cyan} suffix={s.toFixed(2)} />)}
      </View>
      <Explain k={mine.join('')} title={rec.scores.length ? `Te recomiendo: ${FILMS[rec.scores[0].film]} (${rec.scores[0].score.toFixed(1)} ★)` : 'Ya has visto todas'} color={colors.green}>
        {rec.scores.length ? <>La predicción para cada película que no has visto es la media de las valoraciones de los demás, <T v="small" bold>ponderada por lo parecidos que son contigo</T>. Es <T v="small" bold>filtrado colaborativo</T> basado en usuarios: «a quienes se parecen a ti les gustó esto».</> : 'Pon alguna en «sin ver» para recibir recomendaciones.'}
      </Explain>
    </Frame>
  );
}
