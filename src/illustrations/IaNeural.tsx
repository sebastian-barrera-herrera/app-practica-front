/** Ilustraciones de la zona 8 del curso de IA: la neurona, la red hacia delante, activaciones, retropropagación, entrenamiento y optimizadores. */
import React, { useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Ellipse, Line, Path, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { tap } from '@/lib/haptics';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import {
  ACT_NAMES, GATE_INPUTS, GATE_TARGETS, OPT_NAMES, accuracyOf, act, bestGateScore, bpGraph, curve, dact, forwardXor, gateScore, lossOf, makeNet, moonsData, neuron, optPath, predict, softmax, trainEpochs, valley,
  type Act, type Gate, type Net, type Opt,
} from './iaNnLogic';
import { Callout, Explain, Frame, Meter, Pill, Stepper, Tabs, Toggle } from './iaui';

const Btn = ({ label, onPress, color, disabled }: { label: string; onPress: () => void; color: string; disabled?: boolean }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={() => { tap(); onPress(); }} style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: color, alignSelf: 'flex-start', opacity: disabled ? 0.4 : 1 }}>
    <T bold color="#0B0B14">{label}</T>
  </Pressable>
);

const r2 = (v: number): string => (Math.abs(v) < 0.005 ? '0' : v.toFixed(2));

// ───────────────────────── una neurona y las puertas lógicas ─────────────────────────

export function NeuronDemo() {
  const [w1, setW1] = useState(1);
  const [w2, setW2] = useState(1);
  const [b, setB] = useState(-1.5);
  const [a, setA] = useState<Act>('paso');
  const [gate, setGate] = useState<Gate>('AND');
  const score = gateScore(w1, w2, b, a, gate);
  const best = useMemo(() => bestGateScore(gate, a), [gate, a]);
  const W = 240;
  const H = 200;
  const X = (v: number): number => 30 + ((v + 0.4) / 1.8) * (W - 40);
  const Y = (v: number): number => H - 24 - ((v + 0.4) / 1.8) * (H - 40);
  const cells: { x: number; y: number; o: number }[] = [];
  for (let i = 0; i < 18; i++) for (let j = 0; j < 18; j++) {
    const x = -0.4 + (i / 17) * 1.8;
    const y = -0.4 + (j / 17) * 1.8;
    const o = neuron(w1, w2, b, a, x, y);
    cells.push({ x, y, o: a === 'tanh' ? (o + 1) / 2 : Math.max(0, Math.min(1, o)) });
  }
  const done = score === 4;
  return (
    <Frame>
      <Tabs items={(['AND', 'OR', 'XOR'] as Gate[]).map((g) => ({ id: g, label: g }))} value={gate} onChange={setGate} color={colors.violet} />
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {cells.map((c, n) => <Rect key={n} x={X(c.x) - 6} y={Y(c.y) - 6} width={12} height={12} fill={colors.green} opacity={0.08 + 0.5 * c.o} />)}
        <Line x1={X(0)} x2={X(0)} y1={Y(-0.4)} y2={Y(1.4)} stroke={colors.line} />
        <Line x1={X(-0.4)} x2={X(1.4)} y1={Y(0)} y2={Y(0)} stroke={colors.line} />
        {GATE_INPUTS.map(([x1, x2], i) => {
          const t = GATE_TARGETS[gate][i];
          const out = neuron(w1, w2, b, a, x1, x2);
          const pred = a === 'tanh' ? (out > 0 ? 1 : 0) : out >= 0.5 ? 1 : 0;
          const ok = pred === t;
          return (
            <React.Fragment key={i}>
              <Circle cx={X(x1)} cy={Y(x2)} r={13} fill={t ? colors.green : colors.rose} stroke={ok ? colors.text : colors.amber} strokeWidth={ok ? 1.5 : 3} />
              <SvgText x={X(x1) - 9} y={Y(x2) + 4} fontSize={10} fill="#0B0B14" fontFamily={fonts.monoBold}>{out.toFixed(1)}</SvgText>
            </React.Fragment>
          );
        })}
        <SvgText x={X(1.2)} y={Y(-0.3)} fontSize={10} fill={colors.dim} fontFamily={fonts.mono}>x₁</SvgText>
        <SvgText x={X(-0.35)} y={Y(1.3)} fontSize={10} fill={colors.dim} fontFamily={fonts.mono}>x₂</SvgText>
      </Svg>
      <Tabs items={(Object.keys(ACT_NAMES) as Act[]).slice(0, 4).map((k) => ({ id: k, label: ACT_NAMES[k] }))} value={a} onChange={setA} color={colors.cyan} />
      <Stepper label="Peso w₁" value={w1} min={-3} max={3} step={0.5} onChange={setW1} />
      <Stepper label="Peso w₂" value={w2} min={-3} max={3} step={0.5} onChange={setW2} />
      <Stepper label="Sesgo b" value={b} min={-3} max={3} step={0.5} onChange={setB} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`z = ${r2(w1)}·x₁ + ${r2(w2)}·x₂ + ${r2(b)}`} color={colors.dim} />
        <Pill text={`aciertos ${score}/4`} color={done ? colors.green : colors.amber} solid />
      </View>
      <Explain k={`${gate}-${done}-${a}`} title={done ? '✅ La neurona resuelve ' + gate : gate === 'XOR' ? '🧱 XOR no tiene solución con una neurona' : 'Ajusta pesos y sesgo'} color={done ? colors.green : gate === 'XOR' ? colors.rose : colors.cyan}>
        {gate === 'XOR' ? <>La frontera de una neurona es una <T v="small" bold>recta</T> (z = 0) y XOR necesita separar las esquinas opuestas. Con cualquier peso el máximo posible es <T v="small" bold>{best}/4</T>: por eso hacen falta <T v="small" bold>capas</T>.</> : <>La zona verde es donde la salida supera 0.5. Prueba w₁ = w₂ = 1 con b = −1.5 (AND) o b = −0.5 (OR). La recta <T v="small" bold>z = 0</T> separa los puntos si hay solución.</>}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── propagación hacia delante: XOR con una capa oculta ─────────────────────────

export function ForwardDemo() {
  const [x1, setX1] = useState(1);
  const [x2, setX2] = useState(0);
  const [lineal, setLineal] = useState(false);
  const mode = lineal ? 'lineal' : 'relu';
  const f = forwardXor(x1, x2, mode);
  const table = [[0, 0], [0, 1], [1, 0], [1, 1]].map(([a, c]) => ({ a, c, out: forwardXor(a, c, mode).out }));
  const xorOk = table.every((r, i) => r.out === [0, 1, 1, 0][i]);
  const node = (cx: number, cy: number, label: string, v: number, col: string) => (
    <React.Fragment key={label}>
      <Circle cx={cx} cy={cy} r={20} fill={col + '33'} stroke={col} strokeWidth={2} />
      <SvgText x={cx - 9} y={cy + 4} fontSize={12} fill={colors.text} fontFamily={fonts.monoBold}>{r2(v)}</SvgText>
      <SvgText x={cx - 6} y={cy - 26} fontSize={10} fill={colors.dim} fontFamily={fonts.mono}>{label}</SvgText>
    </React.Fragment>
  );
  const edge = (x: number, y: number, x2_: number, y2_: number, w: number) => <Line key={`${x}${y}${x2_}${y2_}`} x1={x + 20} y1={y} x2={x2_ - 20} y2={y2_} stroke={w < 0 ? colors.rose : colors.cyan} strokeWidth={1 + Math.abs(w)} opacity={0.7} />;
  return (
    <Frame>
      <Svg width="100%" height={170} viewBox="0 0 300 170">
        {edge(40, 55, 150, 55, 1)}{edge(40, 55, 150, 115, 1)}{edge(40, 115, 150, 55, 1)}{edge(40, 115, 150, 115, 1)}
        {edge(150, 55, 260, 85, 1)}{edge(150, 115, 260, 85, -2)}
        {node(40, 55, 'x₁', x1, colors.violet)}{node(40, 115, 'x₂', x2, colors.violet)}
        {node(150, 55, lineal ? 'h₁=x₁+x₂' : 'h₁=ReLU(x₁+x₂)', f.h1, colors.cyan)}{node(150, 115, lineal ? 'h₂=x₁+x₂−1' : 'h₂=ReLU(x₁+x₂−1)', f.h2, colors.cyan)}
        {node(260, 85, 'salida', f.out, f.out === (x1 ^ x2) ? colors.green : colors.amber)}
      </Svg>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Btn label={`x₁ = ${x1}`} color={colors.violet} onPress={() => setX1(1 - x1)} />
        <Btn label={`x₂ = ${x2}`} color={colors.violet} onPress={() => setX2(1 - x2)} />
      </View>
      <Toggle label="Sin función de activación (capas lineales)" on={lineal} set={setLineal} good="off" hint="Quita el «codo» de la ReLU: la red entera se reduce a una sola recta" />
      <View style={{ gap: 3 }}>
        {table.map((r, i) => {
          const want = [0, 1, 1, 0][i];
          return <T key={i} v="small" color={r.out === want ? colors.green : colors.rose} style={{ fontFamily: fonts.mono }}>{r.a} XOR {r.c} → {r2(r.out)} {r.out === want ? '✓' : `✗ (debería ser ${want})`}</T>;
        })}
      </View>
      <Explain k={`${lineal}-${xorOk}`} title={xorOk ? '✅ XOR resuelto' : '❌ Se ha colapsado a una recta'} color={xorOk ? colors.green : colors.rose}>
        {xorOk ? <>La capa oculta calcula dos «ayudantes»: <T v="small" bold>h₁</T> (cuántas entradas valen 1) y <T v="small" bold>h₂</T> (se activa solo si son las dos). La salida h₁ − 2·h₂ vale 0, 1, 1, 0.</> : <>Sin activación, h₁ y h₂ son lineales y la salida es <T v="small" bold>2 − (x₁ + x₂)</T>: una sola recta, igual que una neurona. <T v="small" bold>Apilar capas lineales no añade potencia.</T></>}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── funciones de activación ─────────────────────────

export function ActivationsDemo() {
  const [tab, setTab] = useState<Act | 'softmax'>('sigmoide');
  const [x, setX] = useState(1);
  const [logits, setLogits] = useState<[number, number, number]>([2, 1, 0.1]);
  const [temp, setTemp] = useState(1);
  const tabs = [...(['sigmoide', 'tanh', 'relu', 'leaky'] as Act[]).map((k) => ({ id: k as Act | 'softmax', label: ACT_NAMES[k] })), { id: 'softmax' as const, label: 'Softmax' }];
  const W = 280;
  const H = 150;
  const c = tab === 'softmax' ? [] : curve(tab, -6, 6, 60);
  const ymax = tab === 'relu' || tab === 'leaky' ? 6 : 1.4;
  const ymin = tab === 'leaky' ? -1 : tab === 'relu' ? -0.5 : tab === 'sigmoide' ? -0.3 : -1.3;
  const PX = (v: number): number => 10 + ((v + 6) / 12) * (W - 20);
  const PY = (v: number): number => H - 10 - ((v - ymin) / (ymax - ymin)) * (H - 20);
  const poly = (key: 'y' | 'd') => c.map((p) => `${PX(p.x).toFixed(1)},${PY(Math.max(ymin, Math.min(ymax, p[key]))).toFixed(1)}`).join(' ');
  if (tab === 'softmax') {
    const p = softmax(logits, temp);
    const cols = [colors.cyan, colors.amber, colors.rose];
    return (
      <Frame>
        <Tabs items={tabs} value={tab} onChange={setTab} color={colors.violet} />
        {logits.map((v, i) => <Stepper key={i} label={`Logit z${i + 1}`} value={v} min={-5} max={8} step={0.5} onChange={(n) => setLogits(logits.map((q, j) => (j === i ? n : q)) as [number, number, number])} />)}
        <Stepper label="Temperatura" value={temp} min={0.5} max={5} step={0.5} onChange={setTemp} />
        {p.map((v, i) => <Meter key={i} label={`clase ${i + 1}`} value={v} color={cols[i]} suffix={`${(v * 100).toFixed(1)} %`} />)}
        <Callout color={colors.violet}>
          <T v="small" bold>Softmax</T> convierte números cualesquiera (logits) en probabilidades que suman 1: los mayores se llevan casi todo. Con <T v="small" bold>temperatura</T> alta el reparto se aplana (más variedad, como al generar texto); con temperatura baja se concentra en el ganador.
        </Callout>
      </Frame>
    );
  }
  const v = act(tab, x);
  const d = dact(tab, x);
  const sat = Math.abs(d) < 0.05;
  return (
    <Frame>
      <Tabs items={tabs} value={tab} onChange={setTab} color={colors.violet} />
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line x1={10} x2={W - 10} y1={PY(0)} y2={PY(0)} stroke={colors.line} />
        <Line x1={PX(0)} x2={PX(0)} y1={8} y2={H - 8} stroke={colors.line} />
        <Polyline points={poly('d')} stroke={colors.amber} strokeWidth={2} fill="none" strokeDasharray="5,4" />
        <Polyline points={poly('y')} stroke={colors.cyan} strokeWidth={3} fill="none" />
        <Circle cx={PX(x)} cy={PY(Math.max(ymin, Math.min(ymax, v)))} r={6} fill={colors.cyan} stroke={colors.bg} strokeWidth={2} />
        <SvgText x={12} y={14} fontSize={10} fill={colors.cyan} fontFamily={fonts.mono}>— f(z)</SvgText>
        <SvgText x={70} y={14} fontSize={10} fill={colors.amber} fontFamily={fonts.mono}>- - f′(z) (la derivada)</SvgText>
      </Svg>
      <Stepper label="Entrada z" value={x} min={-6} max={6} step={0.5} onChange={setX} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`f(${x}) = ${v.toFixed(3)}`} color={colors.cyan} solid />
        <Pill text={`f′(${x}) = ${d.toFixed(3)}`} color={sat ? colors.rose : colors.amber} solid />
      </View>
      <Explain k={`${tab}-${sat}`} title={sat ? '⚠️ Zona saturada' : tab === 'relu' && x < 0 ? '💀 ReLU apagada' : 'Gradiente sano'} color={sat || (tab === 'relu' && x < 0) ? colors.rose : colors.green}>
        {sat ? <>La derivada es casi 0: la neurona <T v="small" bold>apenas aprende</T> porque el gradiente que viaja hacia atrás se multiplica por ese número. Es el problema del <T v="small" bold>gradiente evanescente</T> de sigmoide y tanh.</> : tab === 'relu' && x < 0 ? <>Con z negativo la ReLU vale 0 y su derivada también: esa neurona no recibe ningún gradiente (si le ocurre siempre, está «muerta»). La <T v="small" bold>Leaky ReLU</T> deja pasar un poco.</> : tab === 'sigmoide' ? <>La sigmoide aplasta todo a (0, 1); su derivada máxima es solo <T v="small" bold>0.25</T> (en z = 0).</> : tab === 'tanh' ? <>tanh va de −1 a 1 y está centrada en 0; su derivada máxima es 1.</> : <>Con z positivo la derivada es 1: el gradiente pasa intacto. Por eso <T v="small" bold>ReLU</T> es la opción por defecto en capas ocultas.</>}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── retropropagación: la regla de la cadena ─────────────────────────

export function BackpropDemo() {
  const [w, setW] = useState(0.8);
  const [lr, setLr] = useState(1);
  const [stage, setStage] = useState(0);
  const x = 1.5;
  const b = -0.5;
  const y = 1;
  const g = bpGraph(w, b, x, y);
  const next = bpGraph(w - lr * g.dLdw, b, x, y);
  const stages = [
    { t: 'z = w·x + b', v: g.z, expl: `Con w = ${w.toFixed(2)}, x = ${x}, b = ${b}: z = ${g.z.toFixed(3)}.` },
    { t: 'a = σ(z)', v: g.a, expl: `La sigmoide lo convierte en una probabilidad: a = ${g.a.toFixed(3)}.` },
    { t: 'L = (a − y)²', v: g.loss, expl: `La verdad es y = ${y}: el error al cuadrado es L = ${g.loss.toFixed(4)}.` },
    { t: '∂L/∂a = 2(a − y)', v: g.dLda, expl: `Primer eslabón hacia atrás: cuánto cambia L si cambia a. Vale ${g.dLda.toFixed(3)}.` },
    { t: '∂a/∂z = a(1 − a)', v: g.dadz, expl: `Segundo eslabón: la derivada de la sigmoide en este punto, ${g.dadz.toFixed(3)}.` },
    { t: '∂z/∂w = x', v: g.dzdw, expl: `Tercer eslabón: z depende de w con pendiente x = ${g.dzdw}.` },
    { t: '∂L/∂w = producto', v: g.dLdw, expl: `Regla de la cadena: ${g.dLda.toFixed(3)} × ${g.dadz.toFixed(3)} × ${g.dzdw} = ${g.dLdw.toFixed(4)}. Negativo ⇒ hay que SUBIR w.` },
    { t: 'w ← w − η·∂L/∂w', v: w - lr * g.dLdw, expl: `Actualizamos: w pasa a ${(w - lr * g.dLdw).toFixed(3)} y la pérdida baja de ${g.loss.toFixed(4)} a ${next.loss.toFixed(4)}.` },
  ];
  const i = Math.min(stage, stages.length - 1);
  const back = i >= 3;
  return (
    <Frame>
      <View style={{ gap: 6 }}>
        {stages.map((s, n) => {
          const shown = n <= i;
          const col = n < 3 ? colors.cyan : n < 7 ? colors.amber : colors.green;
          return (
            <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: shown ? 1 : 0.28, borderWidth: n === i ? 2 : 1, borderColor: n === i ? col : colors.line, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6 }}>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 12.5, flex: 1 }} color={shown ? col : colors.dim}>{n < 3 ? '→ ' : n < 7 ? '← ' : '↻ '}{s.t}</T>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 13 }} color={colors.text}>{shown ? s.v.toFixed(3) : '?'}</T>
            </View>
          );
        })}
      </View>
      <Stepper label="Peso inicial w" value={w} min={-2} max={3} step={0.2} onChange={(n) => { setW(Math.round(n * 10) / 10); setStage(0); }} />
      <Stepper label="Tasa de aprendizaje η" value={lr} min={0.5} max={8} step={0.5} onChange={setLr} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn label={i >= stages.length - 1 ? '↺ Reiniciar' : back ? '← Siguiente eslabón' : '→ Siguiente paso'} color={back ? colors.amber : colors.cyan} onPress={() => setStage(i >= stages.length - 1 ? 0 : i + 1)} />
      </View>
      <Explain k={i} title={i < 3 ? 'Pasada hacia delante' : i < 7 ? 'Pasada hacia atrás' : 'Actualización'} color={i < 3 ? colors.cyan : i < 7 ? colors.amber : colors.green}>
        {stages[i].expl}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── entrenar una red sobre dos lunas ─────────────────────────

export function TrainNetDemo() {
  const data = useMemo(() => moonsData(60, 3), []);
  const [h, setH] = useState(6);
  const [lr, setLr] = useState(0.5);
  const net = useRef<Net>(makeNet(6, 5));
  const [tick, setTick] = useState(0);
  const [hist, setHist] = useState<number[]>([lossOf(net.current, data)]);
  const reset = (nh = h) => {
    net.current = makeNet(nh, 5);
    setHist([lossOf(net.current, data)]);
    setTick((t) => t + 1);
  };
  const train = (e: number) => {
    const hh = trainEpochs(net.current, data, lr, e);
    setHist((p) => [...p, hh[hh.length - 1]].slice(-80));
    setTick((t) => t + 1);
  };
  const W = 260;
  const H = 180;
  const X = (v: number): number => 10 + ((v + 1.3) / 3.6) * (W - 20);
  const Y = (v: number): number => H - 10 - ((v + 0.8) / 2.1) * (H - 20);
  const cells = useMemo(() => {
    const out: { x: number; y: number; p: number }[] = [];
    for (let i = 0; i < 26; i++) for (let j = 0; j < 17; j++) {
      const x = -1.3 + (i / 25) * 3.6;
      const y = -0.8 + (j / 16) * 2.1;
      out.push({ x, y, p: predict(net.current, x, y) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
  const acc = accuracyOf(net.current, data);
  const loss = hist[hist.length - 1];
  const maxL = Math.max(...hist, 0.01);
  const spark = hist.map((v, i) => `${(6 + (i / Math.max(1, hist.length - 1)) * 248).toFixed(1)},${(40 - (v / maxL) * 34).toFixed(1)}`).join(' ');
  return (
    <Frame>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {cells.map((c, n) => <Rect key={n} x={X(c.x) - 5} y={Y(c.y) - 5} width={10} height={10} fill={c.p >= 0.5 ? colors.green : colors.rose} opacity={0.12 + 0.3 * Math.abs(c.p - 0.5) * 2} />)}
        {data.map((p, n) => <Circle key={n} cx={X(p.x)} cy={Y(p.y)} r={3.8} fill={p.c ? colors.green : colors.rose} stroke={colors.text} strokeWidth={0.8} />)}
      </Svg>
      <Svg width="100%" height={46} viewBox="0 0 260 46">
        <Rect x={0} y={0} width={260} height={46} fill="none" stroke={colors.line} />
        <Polyline points={spark} stroke={colors.violet} strokeWidth={2.5} fill="none" />
        <SvgText x={8} y={12} fontSize={9} fill={colors.dim} fontFamily={fonts.mono}>pérdida</SvgText>
      </Svg>
      <Stepper label="Neuronas ocultas" value={h} min={1} max={12} step={1} onChange={(n) => { setH(n); reset(n); }} />
      <Stepper label="Tasa de aprendizaje" value={lr} min={0.05} max={5} step={0.05} onChange={(n) => setLr(Math.round(n * 100) / 100)} />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Btn label="▶ 50 épocas" color={colors.green} onPress={() => train(50)} />
        <Btn label="⏩ 400 épocas" color={colors.cyan} onPress={() => train(400)} />
        <Btn label="↺ Reiniciar" color={colors.violet} onPress={() => reset()} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`época ${net.current.epoch}`} color={colors.dim} />
        <Pill text={`pérdida ${loss.toFixed(3)}`} color={colors.violet} solid />
        <Pill text={`acierto ${(acc * 100).toFixed(0)} %`} color={acc > 0.9 ? colors.green : colors.amber} solid />
      </View>
      <Explain k={`${h}-${lr}-${acc > 0.9}-${loss > 1}`} title={loss > 1 || !Number.isFinite(loss) ? '💥 Inestable' : acc > 0.93 ? '✅ Frontera curva aprendida' : h <= 2 ? 'Pocas neuronas' : 'Entrenando…'} color={loss > 1 ? colors.rose : acc > 0.93 ? colors.green : colors.amber}>
        {loss > 1 ? <>Con una tasa de aprendizaje tan alta los pasos se pasan de largo y la pérdida <T v="small" bold>sube</T>. Reinicia y prueba con valores menores.</> : h <= 2 ? <>Con {h} neurona(s) oculta(s) la red apenas puede doblar la frontera. Añade neuronas y entrena de nuevo: <T v="small" bold>más capacidad = fronteras más flexibles</T>.</> : <>Cada época: pasada hacia delante, pérdida, retropropagación y un paso de descenso. La frontera pasa de una línea torpe a una curva que sigue las lunas.</>}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── optimizadores sobre un valle ─────────────────────────

export function OptimizersDemo() {
  const [lr, setLr] = useState(0.03);
  const [steps, setSteps] = useState(40);
  const cols: Record<Opt, string> = { sgd: colors.cyan, momento: colors.amber, adam: colors.green };
  const lrs: Record<Opt, number> = { sgd: lr, momento: lr, adam: lr * 10 };
  const res = (Object.keys(OPT_NAMES) as Opt[]).map((k) => ({ k, ...optPath(k, lrs[k], steps) }));
  const W = 280;
  const H = 150;
  const PX = (v: number): number => 14 + ((v + 5) / 10) * (W - 28);
  const PY = (v: number): number => H / 2 - (v / 1.3) * (H / 2 - 8);
  const clampP = (p: [number, number]): [number, number] => [Math.max(-5, Math.min(5, p[0])), Math.max(-1.3, Math.min(1.3, p[1]))];
  return (
    <Frame>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {[1, 2, 3, 4].map((k) => <Ellipse key={k} cx={PX(0)} cy={PY(0)} rx={(k * 1.1 / 10) * (W - 28)} ry={(k * 1.1 / 5 / 1.3) * (H / 2 - 8)} fill="none" stroke={colors.line} strokeWidth={1} />)}
        <Circle cx={PX(0)} cy={PY(0)} r={4} fill={colors.text} />
        <Circle cx={PX(4)} cy={PY(1)} r={4} fill={colors.dim} />
        {res.map(({ k, path }) => (
          <Path key={k} d={path.map((p, i) => { const c = clampP(p); return `${i ? 'L' : 'M'}${PX(c[0]).toFixed(1)},${PY(c[1]).toFixed(1)}`; }).join(' ')} stroke={cols[k]} strokeWidth={2.4} fill="none" opacity={0.95} />
        ))}
      </Svg>
      <Stepper label="Tasa de aprendizaje (Adam usa ×10)" value={lr} min={0.01} max={0.09} step={0.01} onChange={(n) => setLr(Math.round(n * 100) / 100)} />
      <Stepper label="Pasos" value={steps} min={5} max={100} step={5} onChange={setSteps} />
      {res.map(({ k, loss }) => <Meter key={k} label={`${OPT_NAMES[k]} · pérdida final`} value={Math.min(1, loss / valley(4, 1))} color={cols[k]} suffix={loss > 1e4 ? 'diverge 💥' : loss.toFixed(4)} />)}
      <Explain k={`${lr}-${steps}`} title={res[0].loss > valley(4, 1) ? '💥 SGD diverge' : 'Tres formas de bajar'} color={res[0].loss > valley(4, 1) ? colors.rose : colors.violet}>
        {res[0].loss > valley(4, 1) ? <>Con esta tasa SGD rebota de pared a pared del valle y se aleja. Bájala: es el <T v="small" bold>hiperparámetro más importante</T>.</> : <>El valle es muy empinado en un eje y plano en el otro. <T v="small" bold>SGD</T> zigzaguea; el <T v="small" bold>momento</T> acumula velocidad en la dirección buena; <T v="small" bold>Adam</T> adapta el paso a cada parámetro y llega al fondo casi en línea recta.</>}
      </Explain>
    </Frame>
  );
}
