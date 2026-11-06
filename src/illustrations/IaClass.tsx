/** Ilustraciones de la zona 5 del curso de IA: clasificación (sigmoide, árboles, vecinos, SVM y conjuntos). */
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { tap } from '@/lib/haptics';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { SIG_POINTS, bestThreshold, blobs2D, ensembleAccuracy, giniSplit, knnGrid, majorityAccuracy, moons2D, sigmoid, sigmoidView, svmFit, type SvmKernel } from './iaMlLogic';
import { Callout, Explain, Frame, Meter, Pill, Stepper, Tabs } from './iaui';

const r1 = (v: number): number => Math.round(v * 10) / 10;

const Btn = ({ label, onPress, color }: { label: string; onPress: () => void; color: string }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => { tap(); onPress(); }} style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: color, alignSelf: 'flex-start' }}>
    <T bold color="#0B0B14">{label}</T>
  </Pressable>
);

// ───────────────────────── sigmoide y umbral ─────────────────────────

export function SigmoidDemo() {
  const [w, setW] = useState(1);
  const [b, setB] = useState(-3);
  const [t, setT] = useState(0.5);
  const v = useMemo(() => sigmoidView(w, b, t), [w, b, t]);
  const W = 300;
  const H = 170;
  const X = (x: number): number => 22 + (x / 8) * (W - 36);
  const Y = (p: number): number => H - 22 - p * (H - 40);
  const path = Array.from({ length: 81 }, (_, i) => `${i ? 'L' : 'M'}${X(i / 10).toFixed(1)},${Y(sigmoid(w * (i / 10) + b)).toFixed(1)}`).join(' ');
  const col = v.accuracy >= 0.85 ? colors.green : v.accuracy >= 0.7 ? colors.amber : colors.rose;
  return (
    <Frame>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line x1={22} x2={W - 8} y1={Y(t)} y2={Y(t)} stroke={colors.amber} strokeWidth={1.5} strokeDasharray="4 3" />
        {v.boundary !== null && v.boundary >= 0 && v.boundary <= 8 ? <Line x1={X(v.boundary)} x2={X(v.boundary)} y1={10} y2={H - 22} stroke={colors.green} strokeWidth={1.5} strokeDasharray="2 3" /> : null}
        <Line x1={22} x2={W - 8} y1={Y(0)} y2={Y(0)} stroke={colors.line} strokeWidth={1} />
        <Path d={path} stroke={colors.cyan} strokeWidth={3} fill="none" />
        {SIG_POINTS.map(([x, y], i) => {
          const pred = v.probs[i] >= t ? 1 : 0;
          const ok = pred === y;
          return <Circle key={i} cx={X(x) + ((i * 7) % 5) - 2} cy={Y(y) + (y ? -2 : 2)} r={4.5} fill={y ? colors.amber : colors.violet} stroke={ok ? 'transparent' : colors.rose} strokeWidth={2} />;
        })}
        <SvgText x={24} y={14} fontSize={10} fill={colors.dim} fontFamily={fonts.mono}>P(baja)</SvgText>
        <SvgText x={W - 120} y={H - 6} fontSize={10} fill={colors.dim} fontFamily={fonts.mono}>llamadas a soporte →</SvgText>
      </Svg>
      <Stepper label="Peso w (cuánto pesan las llamadas)" value={w} min={0} max={2.5} step={0.1} onChange={(x) => setW(r1(x))} />
      <Stepper label="Sesgo b" value={b} min={-8} max={2} step={0.5} onChange={(x) => setB(r1(x))} />
      <Stepper label="Umbral de decisión" value={t} min={0.1} max={0.9} step={0.1} onChange={(x) => setT(r1(x))} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`aciertos ${Math.round(v.accuracy * 100)} %`} color={col} solid />
        <Pill text={`falsos positivos ${v.fp}`} color={colors.rose} />
        <Pill text={`falsos negativos ${v.fn}`} color={colors.amber} />
      </View>
      <Callout color={col}>
        Cada punto morado es un cliente que se queda y cada ámbar uno que se da de baja; un borde rojo marca un <T v="small" bold>error de clasificación</T>. {v.boundary !== null && v.boundary >= 0 && v.boundary <= 8 ? <>La frontera de decisión (línea verde) está en {v.boundary.toFixed(1)} llamadas: a partir de ahí el modelo predice «baja».</> : <>Con estos valores la frontera cae fuera de la gráfica: el modelo predice siempre lo mismo.</>} Prueba a bajar el umbral: se detectan más bajas pero también aumentan los falsos positivos.
      </Callout>
    </Frame>
  );
}

// ───────────────────────── Gini y el mejor corte ─────────────────────────

export function TreeSplitDemo() {
  const pts = SIG_POINTS;
  const best = useMemo(() => bestThreshold(pts), [pts]);
  const [thr, setThr] = useState(0.5);
  const s = giniSplit(pts, thr);
  const W = 300;
  const X = (x: number): number => 20 + (x / 8) * (W - 40);
  const bestScore = giniSplit(pts, best);
  const stack: Record<number, number> = {};
  const isBest = Math.abs(thr - best) < 1e-9;
  return (
    <Frame>
      <Svg width="100%" height={120} viewBox={`0 0 ${W} 120`}>
        <Rect x={20} y={8} width={Math.max(0, X(thr) - 20)} height={80} fill={colors.cyan + '1A'} />
        <Rect x={X(thr)} y={8} width={Math.max(0, W - 20 - X(thr))} height={80} fill={colors.rose + '14'} />
        <Line x1={20} x2={W - 20} y1={92} y2={92} stroke={colors.line} strokeWidth={1.5} />
        {pts.map(([x, y], i) => {
          const k = (stack[x] = (stack[x] ?? 0) + 1);
          return <Circle key={i} cx={X(x)} cy={86 - (k - 1) * 11} r={4.6} fill={y ? colors.amber : colors.violet} />;
        })}
        <Line x1={X(thr)} x2={X(thr)} y1={4} y2={96} stroke={colors.green} strokeWidth={2.5} />
        {[0, 2, 4, 6, 8].map((v) => <SvgText key={v} x={X(v) - 3} y={110} fontSize={10} fill={colors.dim} fontFamily={fonts.mono}>{v}</SvgText>)}
      </Svg>
      <Stepper label="Pregunta: ¿llamadas a soporte ≤ …?" value={thr} min={0.5} max={7.5} step={1} onChange={setThr} />
      <View style={{ gap: 6 }}>
        <Meter label={`Izquierda (${s.left[0] + s.left[1]} clientes: ${s.left[0]} se quedan, ${s.left[1]} se van) · Gini`} value={s.giniL * 2} color={colors.cyan} suffix={s.giniL.toFixed(2)} />
        <Meter label={`Derecha (${s.right[0] + s.right[1]} clientes: ${s.right[0]} se quedan, ${s.right[1]} se van) · Gini`} value={s.giniR * 2} color={colors.rose} suffix={s.giniR.toFixed(2)} />
        <Meter label="Gini ponderado tras el corte (menor = mejor)" value={s.weighted * 2} color={colors.green} suffix={s.weighted.toFixed(3)} />
      </View>
      <Btn label="⚡ Mejor corte" color={colors.green} onPress={() => setThr(best)} />
      <Explain k={String(thr)} title={isBest ? '✅ Este es el mejor corte' : `Ganancia de pureza: ${s.gain.toFixed(3)}`} color={isBest ? colors.green : colors.amber}>
        El árbol prueba todos los cortes posibles y se queda con el que más reduce la impureza (aquí «≤ {best}» ganaría {bestScore.gain.toFixed(3)}). Gini = 0 significa un grupo puro (solo una clase); 0.5 es la mezcla máxima con dos clases.
      </Explain>
    </Frame>
  );
}

// ───────────────────────── regiones de KNN ─────────────────────────

const Grid = ({ cells, mode, nx, ny }: { cells: number[][]; mode: 'prob' | 'dec'; nx: number; ny: number }) => (
  <>
    {cells.map((row, j) => row.map((v, i) => {
      const cls = mode === 'prob' ? (v >= 0.5 ? 1 : 0) : v > 0 ? 1 : 0;
      const strength = mode === 'prob' ? Math.abs(2 * v - 1) : Math.min(1, Math.abs(v));
      return <Rect key={`${i}-${j}`} x={(i / nx) * 300} y={(j / ny) * 220} width={300 / nx + 0.6} height={220 / ny + 0.6} fill={cls ? colors.amber : colors.cyan} fillOpacity={0.1 + 0.3 * strength} />;
    }))}
  </>
);

export function KnnRegionDemo() {
  const pts = useMemo(() => moons2D(), []);
  const [k, setK] = useState(5);
  const g = useMemo(() => knnGrid(pts, k), [pts, k]);
  const kind = k <= 1 ? 'sobreajuste' : k >= 25 ? 'infraajuste' : 'equilibrio';
  const col = kind === 'equilibrio' ? colors.green : kind === 'sobreajuste' ? colors.rose : colors.amber;
  return (
    <Frame>
      <Svg width="100%" height={220} viewBox="0 0 300 220">
        <Grid cells={g.cells} mode="prob" nx={22} ny={16} />
        {pts.map((p, i) => <Circle key={i} cx={p.x * 300} cy={(1 - p.y) * 220} r={4.4} fill={p.c ? colors.amber : colors.cyan} stroke={colors.bg} strokeWidth={1.5} />)}
      </Svg>
      <Stepper label="Vecinos (k)" value={k} min={1} max={31} step={2} onChange={setK} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`aciertos en entrenamiento ${Math.round(g.acc * 100)} %`} color={col} solid />
        <Pill text={kind} color={col} />
      </View>
      <Callout color={col}>
        {kind === 'sobreajuste' ? <>Con <T v="small" bold>k = 1</T> cada punto se vota a sí mismo: la frontera se retuerce para acomodar hasta el último punto ruidoso (100 % de aciertos que no se mantendrán con datos nuevos).</> : kind === 'infraajuste' ? <>Con <T v="small" bold>k</T> enorme el vecindario abarca casi todo y la frontera se vuelve tan simple que ignora la forma de las lunas.</> : <>Un <T v="small" bold>k</T> moderado suaviza el ruido y sigue la forma de las dos lunas. Se elige con validación cruzada.</>}
      </Callout>
    </Frame>
  );
}

// ───────────────────────── SVM ─────────────────────────

const C_OPTS = [0.1, 1, 10, 100];
const G_OPTS = [1, 5, 20, 60];

export function SvmDemo() {
  const [data, setData] = useState<'nubes' | 'lunas'>('nubes');
  const [kernel, setKernel] = useState<SvmKernel>('lineal');
  const [ci, setCi] = useState(1);
  const [gi, setGi] = useState(1);
  const pts = useMemo(() => (data === 'nubes' ? blobs2D() : moons2D()), [data]);
  const res = useMemo(() => svmFit(pts, kernel, C_OPTS[ci], G_OPTS[gi]), [pts, kernel, ci, gi]);
  const col = res.acc >= 0.95 ? colors.green : res.acc >= 0.8 ? colors.amber : colors.rose;
  return (
    <Frame>
      <Tabs items={[{ id: 'nubes', label: 'Dos nubes' }, { id: 'lunas', label: 'Dos lunas' }]} value={data} onChange={setData} color={colors.violet} />
      <Tabs items={[{ id: 'lineal', label: 'Núcleo lineal' }, { id: 'rbf', label: 'Núcleo RBF' }]} value={kernel} onChange={setKernel} color={colors.cyan} />
      <Svg width="100%" height={220} viewBox="0 0 300 220">
        <Grid cells={res.cells} mode="dec" nx={22} ny={16} />
        {pts.map((p, i) => <Circle key={i} cx={p.x * 300} cy={(1 - p.y) * 220} r={4.2} fill={p.c ? colors.amber : colors.cyan} stroke={res.sv.includes(i) ? colors.text : colors.bg} strokeWidth={res.sv.includes(i) ? 2.2 : 1.2} />)}
      </Svg>
      <Stepper label={`C (rigidez): ${C_OPTS[ci]}`} value={ci} min={0} max={C_OPTS.length - 1} onChange={setCi} />
      {kernel === 'rbf' ? <Stepper label={`gamma (alcance): ${G_OPTS[gi]}`} value={gi} min={0} max={G_OPTS.length - 1} onChange={setGi} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`aciertos ${Math.round(res.acc * 100)} %`} color={col} solid />
        <Pill text={`${res.sv.length} vectores de soporte`} color={colors.text} />
      </View>
      <Callout color={col}>
        Los puntos con <T v="small" bold>borde blanco</T> son los <T v="small" bold>vectores de soporte</T>: los únicos que definen la frontera. <T v="small" bold>C</T> bajo tolera errores y da un margen ancho; <T v="small" bold>C</T> alto obliga a clasificar bien cada punto (margen estrecho, riesgo de sobreajuste). Con las lunas, el núcleo lineal no basta y el <T v="small" bold>RBF</T> curva la frontera; un <T v="small" bold>gamma</T> alto crea islas alrededor de cada punto.
      </Callout>
    </Frame>
  );
}

// ───────────────────────── el voto del conjunto ─────────────────────────

export function EnsembleVoteDemo() {
  const [n, setN] = useState(11);
  const [p, setP] = useState(0.7);
  const [rho, setRho] = useState(0);
  const acc = ensembleAccuracy(n, p, rho);
  const ideal = majorityAccuracy(n, p);
  const gain = acc - p;
  const col = gain > 0.05 ? colors.green : gain > -0.001 ? colors.amber : colors.rose;
  return (
    <Frame>
      <Stepper label="Número de modelos" value={n} min={1} max={101} step={10} onChange={(v) => setN(v % 2 === 0 ? v + 1 : v)} />
      <Stepper label="Acierto de cada modelo" value={p} min={0.4} max={0.9} step={0.05} onChange={(v) => setP(Math.round(v * 100) / 100)} />
      <Stepper label="Correlación entre modelos" value={rho} min={0} max={1} step={0.25} onChange={(v) => setRho(Math.round(v * 100) / 100)} />
      <View style={{ gap: 8 }}>
        <Meter label="Un modelo solo" value={p} color={colors.cyan} suffix={`${Math.round(p * 100)} %`} />
        <Meter label="Voto de mayoría del conjunto" value={acc} color={col} suffix={`${(acc * 100).toFixed(1)} %`} />
        <Meter label="Si los errores fueran totalmente independientes" value={ideal} color={colors.violet} suffix={`${(ideal * 100).toFixed(1)} %`} />
      </View>
      <Explain k={`${n}-${p}-${rho}`} title={gain > 0.05 ? `+${(gain * 100).toFixed(1)} puntos gracias al conjunto` : gain < -0.001 ? 'El conjunto empeora el resultado' : 'Sin mejora apreciable'} color={col}>
        {p <= 0.5 ? <>Si cada modelo acierta menos de la mitad de las veces, votar <T v="small" bold>amplifica el error</T>: los modelos tienen que ser mejores que el azar.</> : rho >= 0.75 ? <>Si todos los modelos <T v="small" bold>cometen los mismos errores</T> (correlación alta), votar no aporta casi nada. La clave de los bosques es la diversidad: cada árbol ve datos y variables distintos.</> : <>Con modelos aceptables y <T v="small" bold>errores poco correlados</T>, la mayoría acierta mucho más que cada uno. Es la «sabiduría de la multitud» en que se basan los bosques y el bagging.</>}
      </Explain>
    </Frame>
  );
}
