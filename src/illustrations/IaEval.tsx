/** Ilustraciones de la zona 6 del curso de IA: evaluación (confusión, ROC, validación cruzada, sesgo-varianza y búsqueda). */
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { SCORE_SEP, bestTrial, normCdf, biasVariance, confusionAt, foldStats, gridTrials, kfoldDemo, randomTrials, rocAuc, rocCurve, searchScore } from './iaMlLogic';
import { Callout, Explain, Frame, Meter, Pill, Stepper, Tabs } from './iaui';

const pdf = (x: number, m: number): number => Math.exp(-((x - m) ** 2) / 2) / Math.sqrt(2 * Math.PI);

// ───────────────────────── matriz de confusión ─────────────────────────

const PREV = { '50': 0.5, '5': 0.05, '1': 0.01 } as const;

export function ConfusionDemo() {
  const [thr, setThr] = useState(1);
  const [prev, setPrev] = useState<keyof typeof PREV>('50');
  const p = PREV[prev];
  const c = confusionAt(thr, p);
  const W = 300;
  const H = 120;
  const X = (x: number): number => 10 + ((x + 3) / 8) * (W - 20);
  const Y = (v: number): number => H - 14 - v * 150;
  const curve = (m: number, w: number): string => Array.from({ length: 81 }, (_, i) => { const x = -3 + (i / 80) * 8; return `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(pdf(x, m) * w).toFixed(1)}`; }).join(' ');
  const trap = prev !== '50' && c.accuracy > 0.9 && c.recall < 0.5;
  const f = (v: number): string => (v >= 100 ? v.toFixed(0) : v.toFixed(1));
  return (
    <Frame>
      <Tabs items={[{ id: '50', label: '50 % positivos' }, { id: '5', label: '5 % positivos' }, { id: '1', label: '1 % positivos' }]} value={prev} onChange={setPrev} color={colors.violet} />
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Path d={curve(0, 1 - p)} stroke={colors.cyan} strokeWidth={2.5} fill="none" />
        <Path d={curve(SCORE_SEP, p)} stroke={colors.amber} strokeWidth={2.5} fill="none" />
        <Line x1={X(thr)} x2={X(thr)} y1={6} y2={H - 14} stroke={colors.green} strokeWidth={2.5} />
        <Line x1={10} x2={W - 10} y1={H - 14} y2={H - 14} stroke={colors.line} strokeWidth={1} />
        <SvgText x={14} y={14} fontSize={10} fill={colors.cyan} fontFamily={fonts.mono}>negativos</SvgText>
        <SvgText x={W - 70} y={14} fontSize={10} fill={colors.amber} fontFamily={fonts.mono}>positivos</SvgText>
      </Svg>
      <Stepper label="Umbral de decisión (puntuación ≥ umbral ⇒ positivo)" value={thr} min={-1} max={3.5} step={0.25} onChange={setThr} />
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[
          { l: 'VP (acierto +)', v: c.tp, k: colors.green },
          { l: 'FP (falsa alarma)', v: c.fp, k: colors.rose },
        ].map((b) => (
          <View key={b.l} style={{ flex: 1, borderWidth: 1.5, borderColor: b.k, backgroundColor: b.k + '1A', borderRadius: radius.sm, padding: 8 }}>
            <T v="tiny" color={b.k}>{b.l}</T>
            <T style={{ fontFamily: fonts.monoBold, fontSize: 18 }} color={colors.text}>{f(b.v)}</T>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[
          { l: 'FN (positivo perdido)', v: c.fn, k: colors.amber },
          { l: 'VN (acierto −)', v: c.tn, k: colors.green },
        ].map((b) => (
          <View key={b.l} style={{ flex: 1, borderWidth: 1.5, borderColor: b.k, backgroundColor: b.k + '1A', borderRadius: radius.sm, padding: 8 }}>
            <T v="tiny" color={b.k}>{b.l}</T>
            <T style={{ fontFamily: fonts.monoBold, fontSize: 18 }} color={colors.text}>{f(b.v)}</T>
          </View>
        ))}
      </View>
      <View style={{ gap: 6 }}>
        <Meter label="Exactitud (aciertos totales)" value={c.accuracy} color={colors.cyan} />
        <Meter label="Precisión (de los marcados, ¿cuántos son positivos?)" value={c.precision} color={colors.violet} />
        <Meter label="Sensibilidad / recall (de los positivos, ¿cuántos se encuentran?)" value={c.recall} color={colors.amber} />
        <Meter label="F1 (media armónica)" value={c.f1} color={colors.green} />
      </View>
      <Callout color={trap ? colors.rose : colors.green}>
        {trap ? <>¡Cuidado! La exactitud es altísima ({Math.round(c.accuracy * 100)} %) pero el modelo <T v="small" bold>apenas encuentra positivos</T> (recall {Math.round(c.recall * 100)} %). Con clases raras, predecir siempre «negativo» ya da una exactitud enorme: la exactitud engaña.</> : <>Al subir el umbral baja el recall y sube la precisión (marcas menos, pero con más seguridad); al bajarlo ocurre lo contrario. No existe un umbral «correcto»: depende del coste de cada tipo de error.</>}
      </Callout>
    </Frame>
  );
}

// ───────────────────────── curva ROC ─────────────────────────

export function RocDemo() {
  const [d, setD] = useState(1.5);
  const [thr, setThr] = useState(0.75);
  const curve = useMemo(() => rocCurve(d), [d]);
  const auc = rocAuc(d);
  const S = 190;
  const X = (v: number): number => 28 + v * (S - 36);
  const Y = (v: number): number => S - 24 - v * (S - 36);
  const path = curve.map((p, i) => `${i ? 'L' : 'M'}${X(p.fpr).toFixed(1)},${Y(p.tpr).toFixed(1)}`).join(' ');
  const fill = `${path} L${X(1)},${Y(0)} L${X(0)},${Y(0)} Z`;
  const fpr = 1 - normCdf(thr);
  const tpr = 1 - normCdf(thr - d);
  const col = auc >= 0.9 ? colors.green : auc >= 0.75 ? colors.amber : colors.rose;
  return (
    <Frame>
      <Svg width="100%" height={S} viewBox={`0 0 ${S + 60} ${S}`}>
        <Rect x={X(0)} y={Y(1)} width={X(1) - X(0)} height={Y(0) - Y(1)} fill="none" stroke={colors.line} />
        <Line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} stroke={colors.faint} strokeDasharray="4 3" />
        <Path d={fill} fill={col + '33'} />
        <Path d={path} stroke={col} strokeWidth={3} fill="none" />
        <Circle cx={X(fpr)} cy={Y(tpr)} r={6} fill={colors.green} stroke={colors.bg} strokeWidth={2} />
        <SvgText x={X(0.5) - 40} y={S - 6} fontSize={10} fill={colors.dim} fontFamily={fonts.mono}>falsos positivos (FPR) →</SvgText>
        <SvgText x={4} y={14} fontSize={10} fill={colors.dim} fontFamily={fonts.mono}>verdaderos positivos (TPR)</SvgText>
      </Svg>
      <Stepper label="Separación entre clases (σ)" value={d} min={0} max={3.5} step={0.5} onChange={setD} />
      <Stepper label="Umbral (punto verde)" value={thr} min={-1} max={3} step={0.25} onChange={setThr} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`AUC = ${auc.toFixed(3)}`} color={col} solid />
        <Pill text={`TPR ${tpr.toFixed(2)}`} color={colors.amber} />
        <Pill text={`FPR ${fpr.toFixed(2)}`} color={colors.rose} />
      </View>
      <Explain k={`${d}`} title={d === 0 ? 'AUC 0.5: el modelo es un cara o cruz' : auc >= 0.95 ? 'Casi perfecto' : 'Cuanto más al noroeste, mejor'} color={col}>
        Cada punto de la curva es un umbral distinto. La <T v="small" bold>diagonal</T> es adivinar al azar (AUC 0.5). El <T v="small" bold>AUC</T> es la probabilidad de que el modelo ponga una puntuación mayor a un positivo elegido al azar que a un negativo: no depende del umbral, por eso sirve para comparar modelos.
      </Explain>
    </Frame>
  );
}

// ───────────────────────── validación cruzada ─────────────────────────

export function KFoldDemo() {
  const [k, setK] = useState<'3' | '5' | '10'>('5');
  const [cur, setCur] = useState(1);
  const n = 40;
  const folds = useMemo(() => kfoldDemo(n, Number(k)), [k]);
  const st = foldStats(folds);
  const idx = Math.min(cur, folds.length) - 1;
  const owner = new Array<number>(n);
  folds.forEach((f) => f.test.forEach((r) => (owner[r] = f.index)));
  return (
    <Frame>
      <Tabs items={[{ id: '3', label: '3 bloques' }, { id: '5', label: '5 bloques' }, { id: '10', label: '10 bloques' }]} value={k} onChange={(v) => { setK(v); setCur(1); }} color={colors.violet} />
      <Stepper label="Ronda" value={Math.min(cur, folds.length)} min={1} max={folds.length} onChange={setCur} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>
        {owner.map((o, r) => <View key={r} style={{ width: 15, height: 15, borderRadius: 3, backgroundColor: o === idx ? colors.amber : colors.cyan, opacity: o === idx ? 1 : 0.55 }} />)}
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pill text="■ entrenamiento" color={colors.cyan} />
        <Pill text="■ prueba de esta ronda" color={colors.amber} />
      </View>
      <View style={{ gap: 5 }}>
        {folds.map((f) => <Meter key={f.index} label={`Ronda ${f.index + 1}${f.index === idx ? ' (la que ves)' : ''}`} value={f.score} color={f.index === idx ? colors.amber : colors.cyan} suffix={f.score.toFixed(2)} />)}
      </View>
      <Explain k={k} title={`Puntuación final: ${st.mean.toFixed(3)} ± ${st.std.toFixed(3)}`} color={colors.green}>
        Cada fila se usa <T v="small" bold>una vez como prueba</T> y k−1 veces como entrenamiento. La media es una estimación mucho más estable que un único reparto, y la desviación te dice cuánto varía el resultado según los datos que te toquen.
      </Explain>
    </Frame>
  );
}

// ───────────────────────── sesgo y varianza ─────────────────────────

export function BiasVarianceDemo() {
  const [c, setC] = useState(3);
  const [n, setN] = useState<'30' | '300'>('30');
  const data = Number(n);
  const all = useMemo(() => Array.from({ length: 12 }, (_, i) => biasVariance(i + 1, data)), [data]);
  const cur = all[c - 1];
  const W = 300;
  const H = 150;
  const X = (i: number): number => 18 + (i / 11) * (W - 30);
  const mx = 1.2;
  const Y = (v: number): number => H - 18 - (Math.min(v, mx) / mx) * (H - 30);
  const line = (key: 'train' | 'test'): string => all.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p[key]).toFixed(1)}`).join(' ');
  const col = cur.verdict === 'equilibrio' ? colors.green : cur.verdict === 'sesgo alto' ? colors.amber : colors.rose;
  return (
    <Frame>
      <Tabs items={[{ id: '30', label: '30 datos' }, { id: '300', label: '300 datos' }]} value={n} onChange={setN} color={colors.violet} />
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line x1={18} x2={W - 8} y1={H - 18} y2={H - 18} stroke={colors.line} />
        <Path d={line('train')} stroke={colors.cyan} strokeWidth={3} fill="none" />
        <Path d={line('test')} stroke={colors.rose} strokeWidth={3} fill="none" />
        <Line x1={X(c - 1)} x2={X(c - 1)} y1={6} y2={H - 18} stroke={colors.green} strokeDasharray="3 3" />
        <SvgText x={20} y={12} fontSize={10} fill={colors.cyan} fontFamily={fonts.mono}>— error de entrenamiento</SvgText>
        <SvgText x={W - 120} y={12} fontSize={10} fill={colors.rose} fontFamily={fonts.mono}>— error de prueba</SvgText>
        <SvgText x={W / 2 - 40} y={H - 3} fontSize={10} fill={colors.dim} fontFamily={fonts.mono}>complejidad del modelo →</SvgText>
      </Svg>
      <Stepper label="Complejidad (p. ej. grado del polinomio, profundidad del árbol)" value={c} min={1} max={12} onChange={setC} />
      <View style={{ gap: 6 }}>
        <Meter label="Sesgo² (error por ser demasiado simple)" value={Math.min(1, cur.bias2 / 1.2)} color={colors.amber} suffix={cur.bias2.toFixed(2)} />
        <Meter label="Varianza (sensibilidad a los datos concretos)" value={Math.min(1, cur.variance / 1.2)} color={colors.violet} suffix={cur.variance.toFixed(2)} />
        <Meter label="Ruido irreducible" value={cur.noise / 1.2} color={colors.dim} suffix={cur.noise.toFixed(2)} />
      </View>
      <Callout color={col}>
        {cur.verdict === 'sesgo alto' ? <>Modelo <T v="small" bold>demasiado simple</T>: falla incluso en entrenamiento (infraajuste). Hace falta más flexibilidad o mejores características.</> : cur.verdict === 'varianza alta' ? <>Modelo <T v="small" bold>demasiado flexible</T>: perfecto en entrenamiento pero con mucha diferencia en prueba (sobreajuste). Opciones: simplificarlo, regularizar o <T v="small" bold>conseguir más datos</T> (prueba con 300).</> : <>Cerca del punto óptimo: el error de prueba es el mínimo de la curva. Más complejidad ya no compensa.</>}
      </Callout>
    </Frame>
  );
}

// ───────────────────────── rejilla frente a aleatoria ─────────────────────────

export function SearchDemo() {
  const [method, setMethod] = useState<'rejilla' | 'aleatoria'>('rejilla');
  const [budget, setBudget] = useState<'9' | '16' | '25'>('9');
  const n = Number(budget);
  const trials = useMemo(() => (method === 'rejilla' ? gridTrials(Math.sqrt(n)) : randomTrials(n)), [method, n]);
  const gBest = useMemo(() => bestTrial(gridTrials(Math.sqrt(n))), [n]);
  const rBest = useMemo(() => bestTrial(randomTrials(n)), [n]);
  const best = method === 'rejilla' ? gBest : rBest;
  const cells = 24;
  const S = 220;
  return (
    <Frame>
      <Tabs items={[{ id: 'rejilla', label: 'Búsqueda en rejilla' }, { id: 'aleatoria', label: 'Búsqueda aleatoria' }]} value={method} onChange={setMethod} color={colors.violet} />
      <Tabs items={[{ id: '9', label: '9 pruebas' }, { id: '16', label: '16 pruebas' }, { id: '25', label: '25 pruebas' }]} value={budget} onChange={setBudget} color={colors.cyan} />
      <Svg width="100%" height={S} viewBox={`0 0 ${S + 40} ${S}`}>
        {Array.from({ length: cells * cells }, (_, i) => {
          const cx = i % cells;
          const cy = Math.floor(i / cells);
          const s = searchScore((cx + 0.5) / cells, (cy + 0.5) / cells);
          return <Rect key={i} x={20 + (cx / cells) * (S - 20)} y={(cy / cells) * (S - 20)} width={(S - 20) / cells + 0.5} height={(S - 20) / cells + 0.5} fill={colors.green} fillOpacity={Math.max(0, (s - 0.55) / 0.4) * 0.8} />;
        })}
        {trials.map((t, i) => <Circle key={i} cx={20 + t.x * (S - 20)} cy={t.y * (S - 20)} r={4} fill={colors.text} stroke={colors.bg} strokeWidth={1} />)}
        <Polygon points={`${20 + best.x * (S - 20)},${best.y * (S - 20) - 8} ${20 + best.x * (S - 20) + 6},${best.y * (S - 20) + 5} ${20 + best.x * (S - 20) - 6},${best.y * (S - 20) + 5}`} fill={colors.amber} stroke={colors.bg} />
        <SvgText x={22} y={S - 3} fontSize={10} fill={colors.dim} fontFamily={fonts.mono}>parámetro importante →</SvgText>
      </Svg>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`rejilla: mejor ${gBest.score.toFixed(3)}`} color={method === 'rejilla' ? colors.green : colors.dim} solid={method === 'rejilla'} />
        <Pill text={`aleatoria: mejor ${rBest.score.toFixed(3)}`} color={method === 'aleatoria' ? colors.green : colors.dim} solid={method === 'aleatoria'} />
      </View>
      <Callout color={rBest.score > gBest.score ? colors.green : colors.amber}>
        La zona verde es donde el modelo rinde bien: es estrecha en el parámetro horizontal (el importante) y muy ancha en el vertical. Una <T v="small" bold>rejilla</T> repite los mismos pocos valores del parámetro importante; la <T v="small" bold>búsqueda aleatoria</T> prueba valores distintos en cada intento y suele acercarse más al óptimo con el mismo presupuesto. El triángulo ámbar marca el mejor intento.
      </Callout>
    </Frame>
  );
}
