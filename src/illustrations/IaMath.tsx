/** Ilustraciones de la zona 2 del curso de IA: broadcasting, vectores, Monte Carlo y descenso del gradiente. */
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Defs, Line, Marker, Path, Rect, Text as SvgText } from 'react-native-svg';
import { select, tap } from '@/lib/haptics';
import { FigureView } from '@/ui/Figure';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { SHAPE_CHOICES, broadcast, fmtShape, gdF, gdPath, gdVerdict, monteCarloPi, vecFrom, vecStats } from './iaLogic';
import { Callout, Explain, Frame, Meter, Pill, Row, Stepper, Tabs, axes, figJson } from './iaui';

const Btn = ({ label, onPress, color, disabled }: { label: string; onPress: () => void; color: string; disabled?: boolean }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={() => { tap(); onPress(); }} style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: color, opacity: disabled ? 0.4 : 1 }}>
    <T bold color="#0B0B14">{label}</T>
  </Pressable>
);

// ───────────────────────── broadcasting ─────────────────────────

function ShapePicker({ label, value, onChange, color }: { label: string; value: number[]; onChange: (s: number[]) => void; color: string }) {
  return (
    <View style={{ gap: 6 }}>
      <T v="label" color={color}>{label}: {fmtShape(value)}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {SHAPE_CHOICES.map((s) => {
          const on = fmtShape(s) === fmtShape(value);
          return (
            <Pressable key={fmtShape(s)} accessibilityRole="button" accessibilityLabel={`${label} ${fmtShape(s)}`} accessibilityState={{ selected: on }} onPress={() => { select(); onChange(s); }} style={{ minHeight: 34, paddingHorizontal: 10, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: on ? color : color + '1F', borderWidth: 1, borderColor: on ? color : color + '66' }}>
              <T v="tiny" bold color={on ? '#0B0B14' : color} style={{ fontFamily: fonts.monoBold }}>{fmtShape(s)}</T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function BroadcastView() {
  const [a, setA] = useState<number[]>([3, 4]);
  const [b, setB] = useState<number[]>([4]);
  const r = useMemo(() => broadcast(a, b), [a, b]);
  const c = r.ok ? colors.green : colors.rose;
  return (
    <Frame>
      <ShapePicker label="Forma de A" value={a} onChange={setA} color={colors.cyan} />
      <ShapePicker label="Forma de B" value={b} onChange={setB} color={colors.violet} />
      <T v="label" color={colors.dim}>Se comparan de derecha a izquierda</T>
      <View style={{ gap: 6 }}>
        {r.steps.map((s) => (
          <View key={s.axis} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: s.ok ? colors.line : colors.rose, backgroundColor: s.ok ? 'transparent' : colors.rose + '1A', borderRadius: radius.sm, padding: 8 }}>
            <T style={{ fontFamily: fonts.monoBold, fontSize: 13, width: 26 }} color={colors.cyan}>{s.a ?? '·'}</T>
            <T style={{ fontFamily: fonts.monoBold, fontSize: 13, width: 26 }} color={colors.violet}>{s.b ?? '·'}</T>
            <T style={{ fontFamily: fonts.monoBold, fontSize: 13, width: 30 }} color={s.ok ? colors.green : colors.rose}>{s.ok ? `→ ${s.out}` : '✖'}</T>
            <T v="tiny" color={colors.dim} style={{ flex: 1 }}>{s.note}</T>
          </View>
        ))}
      </View>
      <Explain k={`${fmtShape(a)}${fmtShape(b)}`} title={r.ok ? `✅ Resultado ${fmtShape(r.shape)}` : '❌ No se pueden combinar'} color={c}>
        {r.ok ? 'NumPy estira las dimensiones de tamaño 1 sin copiar datos y opera elemento a elemento.' : r.error ?? ''}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── vectores en el plano ─────────────────────────

export function VectorsView() {
  const [angA, setAngA] = useState(0);
  const [angB, setAngB] = useState(45);
  const [lenB, setLenB] = useState(3);
  const a = useMemo(() => vecFrom(angA, 3), [angA]);
  const b = useMemo(() => vecFrom(angB, lenB), [angB, lenB]);
  const st = useMemo(() => vecStats(a, b), [a, b]);
  const W = 260;
  const cx = W / 2;
  const cy = 110;
  const k = 30;
  const P = (v: { x: number; y: number }) => ({ x: cx + v.x * k, y: cy - v.y * k });
  const pa = P(a);
  const pb = P(b);
  const col = st.cos > 0.5 ? colors.green : st.cos < -0.5 ? colors.rose : colors.amber;
  return (
    <Frame>
      <Svg width="100%" height={220} viewBox={`0 0 ${W} 220`}>
        <Defs>
          <Marker id="arrA" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><Path d="M0,0 L8,4 L0,8 z" fill={colors.cyan} /></Marker>
          <Marker id="arrB" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><Path d="M0,0 L8,4 L0,8 z" fill={colors.violet} /></Marker>
        </Defs>
        <Line x1={8} x2={W - 8} y1={cy} y2={cy} stroke={colors.line} strokeWidth={1} />
        <Line x1={cx} x2={cx} y1={8} y2={212} stroke={colors.line} strokeWidth={1} />
        <Line x1={cx} y1={cy} x2={pa.x} y2={pa.y} stroke={colors.cyan} strokeWidth={3} markerEnd="url(#arrA)" />
        <Line x1={cx} y1={cy} x2={pb.x} y2={pb.y} stroke={colors.violet} strokeWidth={3} markerEnd="url(#arrB)" />
        <SvgText x={pa.x + 6} y={pa.y - 4} fontSize={13} fill={colors.cyan} fontFamily={fonts.monoBold}>A</SvgText>
        <SvgText x={pb.x + 6} y={pb.y - 4} fontSize={13} fill={colors.violet} fontFamily={fonts.monoBold}>B</SvgText>
        <Circle cx={cx} cy={cy} r={3} fill={colors.text} />
      </Svg>
      <Stepper label="Ángulo de A" value={angA} min={0} max={345} step={15} unit="°" onChange={setAngA} />
      <Stepper label="Ángulo de B" value={angB} min={0} max={345} step={15} unit="°" onChange={setAngB} />
      <Stepper label="Longitud de B" value={lenB} min={1} max={4} onChange={setLenB} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`A·B = ${st.dot.toFixed(2)}`} color={col} solid />
        <Pill text={`coseno = ${st.cos.toFixed(3)}`} color={col} solid />
        <Pill text={`ángulo = ${st.angle.toFixed(0)}°`} color={colors.dim} />
        <Pill text={`distancia = ${st.dist.toFixed(2)}`} color={colors.dim} />
      </View>
      <Callout color={col}>
        Los vectores son <T v="small" bold>{st.kind}</T>. Cambia solo la longitud de B: el producto escalar cambia, pero el coseno no. Por eso la similitud coseno compara <T v="small" bold>dirección</T>, no tamaño.
      </Callout>
    </Frame>
  );
}

// ───────────────────────── Monte Carlo ─────────────────────────

const MC_N = [10, 50, 200, 1000, 5000];

export function MonteCarloView() {
  const [n, setN] = useState(200);
  const [seed, setSeed] = useState(7);
  const mc = useMemo(() => monteCarloPi(n, seed), [n, seed]);
  const S = 220;
  const shown = mc.pts.slice(0, 1200);
  const err = Math.abs(mc.pi - Math.PI);
  return (
    <Frame>
      <Tabs items={MC_N.map((v) => ({ id: String(v), label: `${v} dardos` }))} value={String(n)} onChange={(v) => setN(Number(v))} color={colors.amber} />
      <View style={{ alignItems: 'center' }}>
        <Svg width={S} height={S} viewBox={`0 0 ${S} ${S}`}>
          <Rect x={1} y={1} width={S - 2} height={S - 2} fill="none" stroke={colors.line} strokeWidth={2} />
          <Path d={`M1 ${S - 1} A ${S - 2} ${S - 2} 0 0 1 ${S - 1} 1`} fill="none" stroke={colors.amber} strokeWidth={2} />
          {shown.map((p, i) => <Circle key={i} cx={1 + p.x * (S - 2)} cy={S - 1 - p.y * (S - 2)} r={n > 500 ? 1.4 : 2.6} fill={p.inside ? colors.green : colors.rose} opacity={0.85} />)}
        </Svg>
      </View>
      <Meter label={`Dentro del círculo: ${mc.inside} de ${n}`} value={n ? mc.inside / n : 0} color={colors.green} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <Pill text={`π ≈ ${mc.pi.toFixed(4)}`} color={colors.amber} solid />
        <Pill text={`error ${err.toFixed(4)}`} color={err < 0.05 ? colors.green : colors.rose} />
        <Btn label="Otra tirada" color={colors.cyan} onPress={() => setSeed((s) => s + 1)} />
      </View>
      <Callout color={colors.amber}>
        Área del cuarto de círculo / área del cuadrado = π/4. Con pocos dardos la estimación salta mucho; con muchos se estabiliza: es la <T v="small" bold>ley de los grandes números</T>.
      </Callout>
    </Frame>
  );
}

// ───────────────────────── descenso del gradiente ─────────────────────────

export function GradientDescentView() {
  const [lr100, setLr100] = useState(10);
  const [x0, setX0] = useState(0);
  const [k, setK] = useState(0);
  const lr = lr100 / 100;
  const path = useMemo(() => gdPath(x0, lr, 40), [x0, lr]);
  const shown = path.slice(0, k + 1);
  const cur = path[k];
  const verdict = gdVerdict(path, lr);
  const curveX = Array.from({ length: 81 }, (_, i) => -3 + i * 0.15);
  const json = useMemo(
    () =>
      figJson(
        axes(
          [
            { t: 'line', x: curveX, y: curveX.map(gdF), color: colors.cyan, lw: 2.5, label: 'pérdida' },
            { t: 'line', x: shown.map((s) => s.x), y: shown.map((s) => s.f), color: colors.amber, lw: 1.5, ls: '--' },
            { t: 'scatter', x: shown.map((s) => s.x), y: shown.map((s) => s.f), color: colors.rose, s: 36, label: 'pasos' },
          ],
          { xlim: [-3, 9], ylim: [0, 40], xlabel: 'x', ylabel: 'pérdida', legend: true },
        ),
        { h: 3 },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- curveX es constante
    [path, k],
  );
  const reset = (nx0 = x0, nlr = lr100) => {
    setK(0);
    setX0(nx0);
    setLr100(nlr);
  };
  const vc = verdict === 'converge' ? colors.green : verdict === 'lento' ? colors.amber : colors.rose;
  const msg =
    verdict === 'converge' ? 'Cada paso se acerca al mínimo (x = 3) y los pasos se van acortando a medida que la pendiente baja.'
    : verdict === 'lento' ? 'Avanza en la dirección correcta pero tan despacio que en 40 pasos no llega. Prueba una tasa mayor.'
    : verdict === 'zigzag' ? 'Con tasa 1.0 salta de un lado al otro del valle sin acercarse jamás: oscila.'
    : 'Los pasos son tan grandes que se pasan del mínimo y cada vez caen más lejos: diverge.';
  return (
    <Frame>
      <Stepper label={`Tasa de aprendizaje = ${lr}`} value={lr100} min={1} max={120} step={5} unit="%" onChange={(v) => reset(x0, v)} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {[1, 10, 40, 90, 100, 110].map((v) => {
          const on = lr100 === v;
          return (
            <Pressable key={v} accessibilityRole="button" accessibilityLabel={`tasa ${v / 100}`} onPress={() => { select(); reset(x0, v); }} style={{ minHeight: 34, paddingHorizontal: 10, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: on ? colors.amber : colors.amber + '1F', borderWidth: 1, borderColor: colors.amber }}>
              <T v="tiny" bold color={on ? '#0B0B14' : colors.amber} style={{ fontFamily: fonts.monoBold }}>lr = {v / 100}</T>
            </Pressable>
          );
        })}
      </View>
      <Stepper label="Punto de partida" value={x0} min={-2} max={8} onChange={(v) => reset(v, lr100)} />
      <FigureView json={json} />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Btn label="Dar un paso" color={colors.green} disabled={k >= 40} onPress={() => setK((v) => Math.min(40, v + 1))} />
        <Btn label="Diez pasos" color={colors.cyan} disabled={k >= 40} onPress={() => setK((v) => Math.min(40, v + 10))} />
        <Btn label="Reiniciar" color={colors.dim} onPress={() => setK(0)} />
      </View>
      <Row label="Paso" color={colors.dim}>{k} · x = {Number.isFinite(cur.x) ? cur.x.toFixed(3) : '∞'} · pérdida = {Number.isFinite(cur.f) ? (cur.f > 1e6 ? cur.f.toExponential(1) : cur.f.toFixed(3)) : '∞'}</Row>
      <Explain k={verdict + lr100} title={verdict === 'converge' ? '✅ Converge' : verdict === 'lento' ? '🐢 Muy lento' : verdict === 'zigzag' ? '↔️ Oscila' : '💥 Diverge'} color={vc}>{msg}</Explain>
    </Frame>
  );
}
