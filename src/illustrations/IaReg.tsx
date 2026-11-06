/** Ilustraciones de la zona 4 del curso de IA: regresión (recta, efecto de cada variable, métricas, regularización y modelos). */
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { tap } from '@/lib/haptics';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { HOUSE_FEATS, LR_POINTS, METRIC_E, METRIC_Y, PATH_ALPHAS, PATH_NAMES, PATH_TRUE, curveData, fitRegressor1D, housePredict, lassoCoefs, lrBest, lrMse, lrResiduals, regMetrics, ridgeCoefs, type ModelKind } from './iaMlLogic';
import { Callout, Explain, Frame, Meter, Pill, Stepper, Tabs } from './iaui';

const r2 = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;

const Btn = ({ label, onPress, color }: { label: string; onPress: () => void; color: string }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => { tap(); onPress(); }} style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: color, alignSelf: 'flex-start' }}>
    <T bold color="#0B0B14">{label}</T>
  </Pressable>
);

// ───────────────────────── la recta de mínimos cuadrados ─────────────────────────

export function LinRegFit() {
  const best = useMemo(() => lrBest(), []);
  const [w, setW] = useState(0.5);
  const [b, setB] = useState(6);
  const line = { w, b };
  const now = lrMse(line);
  const min = lrMse(best);
  const res = lrResiduals(line);
  const W = 300;
  const H = 190;
  const X = (x: number): number => 24 + (x / 11) * (W - 36);
  const Y = (y: number): number => H - 18 - ((y + 2) / 20) * (H - 30);
  const quality = Math.max(0, Math.min(1, min / Math.max(now, 1e-9)));
  const color = quality > 0.95 ? colors.green : quality > 0.5 ? colors.amber : colors.rose;
  return (
    <Frame>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line x1={24} x2={W - 8} y1={Y(0)} y2={Y(0)} stroke={colors.line} strokeWidth={1} />
        <Line x1={X(0)} x2={X(0)} y1={8} y2={H - 14} stroke={colors.line} strokeWidth={1} />
        <Line x1={X(0)} y1={Y(b)} x2={X(11)} y2={Y(w * 11 + b)} stroke={colors.cyan} strokeWidth={3} />
        {LR_POINTS.map(([x, y], i) => {
          const py = Y(w * x + b);
          const e = Math.abs(res[i]);
          const side = (e / 20) * (H - 30);
          return (
            <React.Fragment key={x}>
              <Rect x={X(x)} y={Math.min(py, Y(y))} width={side} height={side} fill={colors.rose + '33'} stroke={colors.rose + '88'} strokeWidth={0.8} />
              <Line x1={X(x)} x2={X(x)} y1={Y(y)} y2={py} stroke={colors.rose} strokeWidth={1.5} strokeDasharray="3 2" />
              <Circle cx={X(x)} cy={Y(y)} r={4.5} fill={colors.violet} />
            </React.Fragment>
          );
        })}
      </Svg>
      <Stepper label="Pendiente (w)" value={w} min={-1} max={4} step={0.1} onChange={(v) => setW(r2(v, 1))} />
      <Stepper label="Ordenada (b)" value={b} min={-5} max={12} step={0.5} onChange={(v) => setB(r2(v, 1))} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`ŷ = ${w}·x ${b < 0 ? '−' : '+'} ${Math.abs(b)}`} color={colors.cyan} />
        <Pill text={`MSE = ${now.toFixed(2)}`} color={color} solid />
        <Pill text={`mínimo = ${min.toFixed(2)}`} color={colors.green} />
      </View>
      <Meter label="Cercanía al mejor ajuste" value={quality} color={color} />
      <Btn label="⚡ Ajuste óptimo" color={colors.green} onPress={() => { setW(r2(best.w, 2)); setB(r2(best.b, 2)); }} />
      <Callout color={color}>
        Los cuadrados rojos son el <T v="small" bold>error al cuadrado</T> de cada punto: el MSE es su media. Mover la recta cambia el tamaño de los cuadrados; los <T v="small" bold>mínimos cuadrados</T> buscan la recta que los hace lo más pequeños posible ({best.w.toFixed(2)}·x {best.b < 0 ? '−' : '+'} {Math.abs(best.b).toFixed(2)}).
      </Callout>
    </Frame>
  );
}

// ───────────────────────── contribución de cada característica ─────────────────────────

export function CoefEffect() {
  const [vals, setVals] = useState<Record<string, number>>(() => Object.fromEntries(HOUSE_FEATS.map((f) => [f.id, f.start])));
  const base = useMemo(() => housePredict(Object.fromEntries(HOUSE_FEATS.map((f) => [f.id, f.start]))), []);
  const p = housePredict(vals);
  const maxAbs = Math.max(...p.parts.map((x) => Math.abs(x.value)), 1);
  return (
    <Frame>
      {HOUSE_FEATS.map((f) => (
        <Stepper key={f.id} label={`${f.label} (${f.coef > 0 ? '+' : ''}${f.coef} por ${f.unit || 'unidad'})`} value={vals[f.id]} min={f.min} max={f.max} step={f.step} unit={f.unit} onChange={(v) => setVals((s) => ({ ...s, [f.id]: v }))} />
      ))}
      <View style={{ gap: 6 }}>
        <T v="label" color={colors.dim}>Cuánto aporta cada variable al precio (miles de €)</T>
        {p.parts.map((x) => {
          const pos = x.value >= 0;
          const c = pos ? colors.green : colors.rose;
          return (
            <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <T v="tiny" color={colors.dim} style={{ width: 92 }}>{x.label}</T>
              <View style={{ flex: 1, height: 14, backgroundColor: colors.line, borderRadius: 7, overflow: 'hidden', flexDirection: 'row' }}>
                <View style={{ flex: 1, alignItems: 'flex-end', justifyContent: 'center' }}>{!pos ? <View style={{ width: `${(Math.abs(x.value) / maxAbs) * 100}%`, height: 14, backgroundColor: c }} /> : null}</View>
                <View style={{ width: 2, backgroundColor: colors.text }} />
                <View style={{ flex: 1, justifyContent: 'center' }}>{pos ? <View style={{ width: `${(x.value / maxAbs) * 100}%`, height: 14, backgroundColor: c }} /> : null}</View>
              </View>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 11.5, width: 54, textAlign: 'right' }} color={c}>{x.value >= 0 ? '+' : ''}{x.value.toFixed(0)}</T>
            </View>
          );
        })}
      </View>
      <Explain k={Math.round(p.total)} title={`Precio estimado: ${p.total.toFixed(0)} mil €`} color={p.total >= base.total ? colors.green : colors.amber}>
        La ordenada (39 mil €) es el punto de partida; cada característica suma o resta según su coeficiente. Respecto a la casa base ({base.total.toFixed(0)} mil €) la diferencia es de {(p.total - base.total) >= 0 ? '+' : ''}{(p.total - base.total).toFixed(0)} mil €. Un coeficiente se lee como «lo que cambia el precio al subir esa variable <T v="small" bold>una unidad, manteniendo las demás igual</T>».
      </Explain>
    </Frame>
  );
}

// ───────────────────────── métricas de regresión ─────────────────────────

export function RegMetricsView() {
  const [out, setOut] = useState(-5);
  const m = regMetrics(out);
  const err = METRIC_E.slice(0, -1).concat([out]);
  const W = 300;
  const H = 120;
  const mx = Math.max(10, ...err.map(Math.abs));
  const kind = m.rmse / m.mae > 1.8 ? 'atípico' : 'parejo';
  const col = kind === 'atípico' ? colors.rose : colors.green;
  return (
    <Frame>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line x1={8} x2={W - 8} y1={H / 2} y2={H / 2} stroke={colors.line} strokeWidth={1} />
        {err.map((e, i) => {
          const h = (Math.abs(e) / mx) * (H / 2 - 8);
          const x = 14 + i * 28;
          return <Rect key={i} x={x} y={e >= 0 ? H / 2 - h : H / 2} width={18} height={Math.max(h, 1)} rx={3} fill={i === err.length - 1 ? col : colors.cyan} />;
        })}
        <SvgText x={14} y={12} fontSize={10} fill={colors.dim} fontFamily={fonts.mono}>error de cada punto (y − ŷ)</SvgText>
      </Svg>
      <Stepper label="Error del último punto" value={out} min={-5} max={60} step={5} onChange={setOut} />
      <View style={{ gap: 8 }}>
        <Meter label="MAE (error absoluto medio)" value={Math.min(1, m.mae / 15)} color={colors.cyan} suffix={m.mae.toFixed(2)} />
        <Meter label="RMSE (raíz del error cuadrático medio)" value={Math.min(1, m.rmse / 15)} color={colors.violet} suffix={m.rmse.toFixed(2)} />
        <Meter label="R² (parte de la variación explicada)" value={Math.max(0, m.r2)} color={m.r2 > 0.8 ? colors.green : m.r2 > 0.5 ? colors.amber : colors.rose} suffix={m.r2.toFixed(3)} />
      </View>
      <Callout color={col}>
        {kind === 'atípico'
          ? <>Un solo error grande hace que el <T v="small" bold>RMSE se aleje del MAE</T> (¡{(m.rmse / m.mae).toFixed(1)} veces!): al elevar al cuadrado, los errores grandes pesan muchísimo. Si te importan los fallos gordos usa RMSE; si quieres una medida robusta, MAE.</>
          : <>Con errores parecidos, MAE y RMSE casi coinciden. Sube el error del último punto y observa cómo el RMSE se dispara mientras el MAE apenas se mueve.</>}
      </Callout>
    </Frame>
  );
}

// ───────────────────────── Ridge y Lasso ─────────────────────────

export function RegPathView() {
  const [kind, setKind] = useState<'ridge' | 'lasso'>('ridge');
  const [ai, setAi] = useState(1);
  const alpha = PATH_ALPHAS[ai];
  const coefs = useMemo(() => (kind === 'ridge' ? ridgeCoefs(alpha * 4) : lassoCoefs(alpha / 3)), [kind, alpha]);
  const zeros = coefs.filter((c) => Math.abs(c) < 1e-9).length;
  const norm = Math.hypot(...coefs);
  const mx = 5;
  return (
    <Frame>
      <Tabs items={[{ id: 'ridge', label: 'Ridge (L2)' }, { id: 'lasso', label: 'Lasso (L1)' }]} value={kind} onChange={setKind} color={colors.violet} />
      <Stepper label={`Penalización α (${ai + 1}/${PATH_ALPHAS.length})`} value={ai} min={0} max={PATH_ALPHAS.length - 1} onChange={setAi} unit="" />
      <T v="tiny" color={colors.dim}>α = {alpha}: cuanto mayor, más se castigan los coeficientes grandes</T>
      <View style={{ gap: 6 }}>
        {coefs.map((c, j) => {
          const dead = Math.abs(c) < 1e-9;
          const col = dead ? colors.faint : PATH_TRUE[j] === 0 ? colors.amber : colors.cyan;
          return (
            <View key={j} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 12, width: 26 }} color={col}>{PATH_NAMES[j]}</T>
              <View style={{ flex: 1, height: 14, backgroundColor: colors.line, borderRadius: 7, flexDirection: 'row', overflow: 'hidden' }}>
                <View style={{ flex: 1, alignItems: 'flex-end', justifyContent: 'center' }}>{c < 0 && !dead ? <View style={{ width: `${Math.min(1, Math.abs(c) / mx) * 100}%`, height: 14, backgroundColor: col }} /> : null}</View>
                <View style={{ width: 2, backgroundColor: colors.text }} />
                <View style={{ flex: 1, justifyContent: 'center' }}>{c > 0 && !dead ? <View style={{ width: `${Math.min(1, c / mx) * 100}%`, height: 14, backgroundColor: col }} /> : null}</View>
              </View>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 11.5, width: 50, textAlign: 'right' }} color={col}>{dead ? '0' : c.toFixed(2)}</T>
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`‖w‖ = ${norm.toFixed(2)}`} color={colors.violet} solid />
        <Pill text={`${zeros} coeficientes a cero`} color={zeros > 0 ? colors.green : colors.dim} />
      </View>
      <Callout color={kind === 'lasso' ? colors.green : colors.cyan}>
        {kind === 'ridge'
          ? <>Ridge <T v="small" bold>encoge</T> todos los coeficientes hacia cero, pero casi nunca llega a cero. En azul, las variables que sí importan; en ámbar, las que son ruido (su verdadero coeficiente es 0).</>
          : <>Lasso <T v="small" bold>apaga</T> variables: con α suficiente deja a cero los coeficientes del ruido (ámbar) y se queda con las importantes. Es selección de características automática.</>}
      </Callout>
    </Frame>
  );
}

// ───────────────────────── tres regresores sobre una curva ─────────────────────────

export function RegModelsView() {
  const d = useMemo(() => curveData(), []);
  const [kind, setKind] = useState<ModelKind>('lineal');
  const [param, setParam] = useState(3);
  const res = useMemo(() => fitRegressor1D(kind, param, d), [kind, param, d]);
  const W = 300;
  const H = 190;
  const X = (x: number): number => 12 + (x / 6) * (W - 24);
  const Y = (y: number): number => H / 2 - y * 56;
  const path = res.curve.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ');
  const real = Array.from({ length: 61 }, (_, i) => `${i ? 'L' : 'M'}${X((i / 60) * 6).toFixed(1)},${Y(Math.sin((i / 60) * 6)).toFixed(1)}`).join(' ');
  const vc = res.verdict === 'bien' ? colors.green : res.verdict === 'sobreajuste' ? colors.rose : colors.amber;
  return (
    <Frame>
      <Tabs items={[{ id: 'lineal', label: 'Recta' }, { id: 'knn', label: 'KNN' }, { id: 'arbol', label: 'Árbol' }]} value={kind} onChange={(k) => { setKind(k); setParam(k === 'knn' ? 5 : 3); }} color={colors.violet} />
      {kind !== 'lineal' ? <Stepper label={kind === 'knn' ? 'Vecinos (k)' : 'Profundidad máxima'} value={param} min={1} max={kind === 'knn' ? 25 : 10} onChange={setParam} /> : null}
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Path d={real} stroke={colors.faint} strokeWidth={1.5} strokeDasharray="4 3" fill="none" />
        <Path d={path} stroke={colors.cyan} strokeWidth={3} fill="none" />
        {d.train.map(([x, y], i) => <Circle key={`a${i}`} cx={X(x)} cy={Y(y)} r={3.4} fill={colors.violet} />)}
        {d.test.map(([x, y], i) => <Circle key={`b${i}`} cx={X(x)} cy={Y(y)} r={3.8} fill="none" stroke={colors.amber} strokeWidth={2} />)}
      </Svg>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`● entrenamiento ${res.trainRmse.toFixed(2)}`} color={colors.violet} />
        <Pill text={`○ prueba ${res.testRmse.toFixed(2)}`} color={colors.amber} />
        <Pill text={res.verdict} color={vc} solid />
      </View>
      <Callout color={vc}>
        {res.verdict === 'infraajuste' ? <>El modelo es <T v="small" bold>demasiado simple</T> para la curva (la línea discontinua es la señal real): falla incluso con los datos de entrenamiento.</> : res.verdict === 'sobreajuste' ? <>Hay mucha diferencia entre el error de entrenamiento y el de prueba: el modelo <T v="small" bold>memoriza el ruido</T>. Prueba a bajar k o la profundidad.</> : <>Buen equilibrio: sigue la forma de la señal sin copiar el ruido. Observa que el error de prueba (○) nunca baja del nivel de ruido de los datos (≈ 0.25).</>}
      </Callout>
    </Frame>
  );
}

void [METRIC_Y];
