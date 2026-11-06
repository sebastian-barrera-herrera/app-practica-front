/** Ilustraciones de la zona 1 del curso de IA: qué es la IA, tipos de aprendizaje, entrenar/probar y sobreajuste. */
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Line, Rect, Text as SvgText } from 'react-native-svg';
import { select } from '@/lib/haptics';
import { FigureView } from '@/ui/Figure';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { AI_LAYERS, LEARNING_TYPES, SPLIT_POINTS, fitData, fitDegree, splitDemo, type Layer } from './iaLogic';
import { Callout, Card2, Explain, Frame, Meter, Pill, Row, Stepper, Tabs, axes, figJson, iaHue } from './iaui';

// ───────────────────────── IA ⊃ ML ⊃ DL ⊃ IA generativa ─────────────────────────

const LAYER_COLOR = (i: number) => [colors.cyan, colors.violet, colors.amber, colors.rose][i];

function Nest({ i, sel, onSel }: { i: number; sel: Layer['id']; onSel: (id: Layer['id']) => void }) {
  const layer = AI_LAYERS[i];
  const c = LAYER_COLOR(i);
  const on = layer.id === sel;
  const inner = i + 1 < AI_LAYERS.length ? <Nest i={i + 1} sel={sel} onSel={onSel} /> : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={layer.title}
      accessibilityState={{ selected: on }}
      onPress={() => { select(); onSel(layer.id); }}
      style={{ borderWidth: on ? 3 : 1.5, borderColor: c, backgroundColor: c + (on ? '33' : '14'), borderRadius: radius.md + 4, padding: 8, gap: 6 }}
    >
      <T style={{ fontFamily: fonts.monoBold, fontSize: 12 }} color={c}>{layer.title}</T>
      {inner}
    </Pressable>
  );
}

export function AiMlDl() {
  const [sel, setSel] = useState<Layer['id']>('ml');
  const i = AI_LAYERS.findIndex((l) => l.id === sel);
  const layer = AI_LAYERS[i];
  const c = LAYER_COLOR(i);
  return (
    <Frame>
      <T v="label" color={colors.dim}>Toca un círculo</T>
      <Nest i={0} sel={sel} onSel={setSel} />
      <Explain k={sel} title={layer.title} color={c}>{layer.what}</Explain>
      <Row label="Ejemplo" color={c}>{layer.example}</Row>
      <Row label="Necesita" color={c}>{layer.needs}</Row>
    </Frame>
  );
}

// ───────────────────────── tres maneras de aprender ─────────────────────────

function Scheme({ id }: { id: 'sup' | 'uns' | 'rl' }) {
  const w = 280;
  const h = 86;
  const a = iaHue();
  if (id === 'sup') {
    const rows = [['🐱', 'gato'], ['🐶', 'perro'], ['🐱', 'gato']];
    return (
      <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'space-around' }}>
        {rows.map(([e, l], k) => (
          <View key={k} style={{ alignItems: 'center', gap: 2 }}>
            <T style={{ fontSize: 26, lineHeight: 32 }}>{e}</T>
            <T style={{ fontFamily: fonts.monoBold, fontSize: 12 }} color={a.a}>→ «{l}»</T>
          </View>
        ))}
        <View style={{ alignItems: 'center', gap: 2 }}>
          <T style={{ fontSize: 26, lineHeight: 32 }}>❓</T>
          <T style={{ fontFamily: fonts.monoBold, fontSize: 12 }} color={colors.amber}>→ ¿?</T>
        </View>
      </View>
    );
  }
  if (id === 'uns') {
    const pts: [number, number, number][] = [[40, 30, 0], [55, 48, 0], [32, 55, 0], [48, 22, 0], [140, 52, 1], [158, 34, 1], [170, 58, 1], [150, 70, 1], [235, 26, 2], [250, 44, 2], [225, 50, 2]];
    const cs = [colors.cyan, colors.rose, colors.amber];
    return (
      <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`}>
        {pts.map(([x, y, g], k) => <Circle key={k} cx={x} cy={y} r={7} fill={cs[g]} opacity={0.9} />)}
        {[[44, 40, 0], [155, 53, 1], [237, 40, 2]].map(([x, y, g], k) => <Circle key={`c${k}`} cx={x} cy={y} r={26} fill="none" stroke={cs[g]} strokeWidth={1.5} strokeDasharray="4,3" />)}
      </Svg>
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' }}>
      {[['🤖', 'agente'], ['🎮', 'entorno']].map(([e, l], k) => (
        <View key={k} style={{ alignItems: 'center' }}>
          <T style={{ fontSize: 28, lineHeight: 34 }}>{e}</T>
          <T v="tiny" color={colors.dim}>{l}</T>
        </View>
      ))}
      <View style={{ gap: 2 }}>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 11.5 }} color={a.a}>acción →</T>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 11.5 }} color={colors.green}>← +1 recompensa</T>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 11.5 }} color={colors.rose}>← −1 castigo</T>
      </View>
    </View>
  );
}

export function LearningTypes() {
  const [id, setId] = useState<'sup' | 'uns' | 'rl'>('sup');
  const t = LEARNING_TYPES.find((x) => x.id === id)!;
  const c = id === 'sup' ? colors.cyan : id === 'uns' ? colors.violet : colors.amber;
  return (
    <Frame>
      <Tabs items={LEARNING_TYPES.map((x) => ({ id: x.id, label: x.title }))} value={id} onChange={setId} color={c} />
      <Card2 color={c}>
        <Scheme id={id} />
      </Card2>
      <Row label="Maestro" color={c}>{t.teacher}</Row>
      <Row label="Datos" color={c}>{t.data}</Row>
      <Row label="Produce" color={c}>{t.output}</Row>
      <Row label="Ejemplo" color={c}>{t.example}</Row>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {t.algos.map((a) => <Pill key={a} text={a} color={c} size={11} />)}
      </View>
    </Frame>
  );
}

// ───────────────────────── entrenar y probar ─────────────────────────

export function SplitDemo() {
  const [n, setN] = useState(20);
  const r = useMemo(() => splitDemo(n), [n]);
  const W = 300;
  const H = 74;
  const X = (x: number) => 14 + (x / 10) * (W - 28);
  const lab = (l: 0 | 1) => (l ? colors.rose : colors.cyan);
  return (
    <Frame>
      <Stepper label="Ejemplos para entrenar" value={r.nTrain} min={4} max={26} step={2} onChange={setN} />
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line x1={10} x2={W - 10} y1={46} y2={46} stroke={colors.line} strokeWidth={2} />
        <Line x1={X(r.threshold)} x2={X(r.threshold)} y1={10} y2={62} stroke={colors.amber} strokeWidth={2} strokeDasharray="5,3" />
        <SvgText x={X(r.threshold)} y={8} fontSize={10} fill={colors.amber} textAnchor="middle" fontFamily={fonts.monoBold}>umbral {r.threshold}</SvgText>
        {SPLIT_POINTS.map((p, i) => {
          const train = i < r.nTrain;
          return train ? (
            <Circle key={i} cx={X(p.x)} cy={46 + (i % 2 ? 8 : -8)} r={5} fill={lab(p.label)} />
          ) : (
            <Circle key={i} cx={X(p.x)} cy={46 + (i % 2 ? 8 : -8)} r={5} fill="none" stroke={lab(p.label)} strokeWidth={2} />
          );
        })}
        <Rect x={10} y={H - 6} width={0} height={0} />
      </Svg>
      <T v="tiny" color={colors.dim}>● entrenamiento ({r.nTrain})  ○ prueba ({r.nTest}) · color = clase real</T>
      <View style={{ gap: 8 }}>
        <T v="label" color={colors.violet}>Modelo «memoria» (copia al vecino más cercano)</T>
        <Meter label="Acierto en entrenamiento" value={r.memTrain} color={colors.violet} />
        <Meter label="Acierto en prueba" value={r.memTest} color={colors.rose} />
        <T v="label" color={colors.green}>Modelo «regla» (un solo umbral)</T>
        <Meter label="Acierto en entrenamiento" value={r.ruleTrain} color={colors.green} />
        <Meter label="Acierto en prueba" value={r.ruleTest} color={colors.green} />
      </View>
      <Callout color={colors.amber}>
        La memoria siempre saca 100 % en entrenamiento… pero copia también los errores de etiquetado. Fíjate en la brecha entre entrenamiento y prueba: eso es el sobreajuste.
      </Callout>
    </Frame>
  );
}

// ───────────────────────── infraajuste y sobreajuste ─────────────────────────

export function FitCurve() {
  const [deg, setDeg] = useState(3);
  const d = useMemo(() => fitData(), []);
  const r = useMemo(() => fitDegree(d, deg), [d, deg]);
  const json = useMemo(
    () =>
      figJson(
        axes(
          [
            { t: 'line', x: r.curve.x, y: r.curve.y, color: colors.amber, lw: 2.5, label: `grado ${deg}` },
            { t: 'scatter', x: d.xt, y: d.yt, color: colors.cyan, s: 40, label: 'entrenamiento' },
            { t: 'scatter', x: d.xs, y: d.ys, color: colors.rose, s: 40, label: 'prueba' },
          ],
          { ylim: [-1.6, 1.6], xlim: [0, 1], legend: true },
        ),
        { h: 3 },
      ),
    [d, r, deg],
  );
  const c = r.verdict === 'bien' ? colors.green : r.verdict === 'infraajuste' ? colors.amber : colors.rose;
  const msg =
    r.verdict === 'infraajuste'
      ? 'Demasiado simple: ni siquiera sigue a los puntos de entrenamiento (mucho sesgo).'
      : r.verdict === 'bien'
        ? 'Sigue la forma de los datos sin perseguir cada punto: generaliza.'
        : 'Se retuerce para pasar por cada punto de entrenamiento y falla en los de prueba (mucha varianza).';
  return (
    <Frame>
      <Stepper label="Grado del polinomio" value={deg} min={1} max={8} onChange={setDeg} />
      <FigureView json={json} />
      <Meter label="Error de entrenamiento" value={Math.min(1, r.trainErr / 0.4)} color={colors.cyan} suffix={r.trainErr.toFixed(3)} />
      <Meter label="Error de prueba" value={Math.min(1, r.testErr / 0.4)} color={colors.rose} suffix={r.testErr.toFixed(3)} />
      <Explain k={r.verdict + deg} title={r.verdict === 'bien' ? '✅ Bien ajustado' : r.verdict === 'infraajuste' ? '📉 Infraajuste' : '🌀 Sobreajuste'} color={c}>{msg}</Explain>
    </Frame>
  );
}
